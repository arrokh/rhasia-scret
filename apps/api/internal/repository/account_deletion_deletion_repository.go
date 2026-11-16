package repository

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/postgres"
	apiService "github.com/nooroctavian/rhasia-scret/apps/api/internal/service"
)

type DeletionRepository struct {
	pool                *pgxpool.Pool
	sessionSecret       []byte
	anonymousAuthSecret []byte
}

func NewDeletionRepository(pool *pgxpool.Pool, sessionSecret []byte, anonymousAuthSecret []byte) (*DeletionRepository, error) {
	if pool == nil || len(sessionSecret) < 32 || len(anonymousAuthSecret) < 32 {
		return nil, errors.New("account deletion repository is not configured")
	}
	return &DeletionRepository{
		pool:                pool,
		sessionSecret:       append([]byte(nil), sessionSecret...),
		anonymousAuthSecret: append([]byte(nil), anonymousAuthSecret...),
	}, nil
}

func (repository *DeletionRepository) Close() {
	clear(repository.sessionSecret)
	clear(repository.anonymousAuthSecret)
	repository.sessionSecret = nil
	repository.anonymousAuthSecret = nil
}

func (repository *DeletionRepository) FindCompletedDeletion(ctx context.Context, authorizationToken string) (*apiService.DeletionResult, error) {
	if !validAccountDeletionToken(authorizationToken) {
		return nil, nil
	}
	digest := repository.digest(accountDeletionAuthorizationContext, authorizationToken)
	defer clear(digest)
	var result apiService.DeletionResult
	err := repository.pool.QueryRow(ctx, `
		SELECT record.id, record.email, record.email_delivery_status,
			record.personal_vault_count, record.shared_vault_deleted_count,
			record.shared_vault_transferred_count, record.authenticator_account_count
		FROM account_deletion_challenges AS challenge
		JOIN account_deletion_records AS record ON record.id = challenge.completed_deletion_id
		WHERE challenge.authorization_digest = $1 AND challenge.completed_deletion_id IS NOT NULL`, digest).Scan(
		&result.ReceiptID, &result.Email, &result.EmailDelivery,
		&result.PersonalVaultCount, &result.SharedVaultDeletedCount,
		&result.SharedVaultTransferredCount, &result.AuthenticatorAccountCount,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load completed account deletion receipt: %w", err)
	}
	result.EmailDelivery = normalizeEmailDeliveryStatus(result.EmailDelivery)
	return &result, nil
}

func (repository *DeletionRepository) DeleteUser(ctx context.Context, applicationUserID string, authorizationToken string, request apiService.DeletionRequest, now time.Time) (apiService.DeletionResult, error) {
	if err := apiService.ValidateDeletionRequest(request); err != nil {
		return apiService.DeletionResult{}, err
	}
	if applicationUserID == "" || !validAccountDeletionToken(authorizationToken) {
		return apiService.DeletionResult{}, apiService.ErrDeletionAuthorization
	}
	authorizationDigest := repository.digest(accountDeletionAuthorizationContext, authorizationToken)
	defer clear(authorizationDigest)
	transaction, err := repository.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return apiService.DeletionResult{}, fmt.Errorf("begin account deletion transaction: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	emailLocks, err := loadDeletionEmailLocks(ctx, transaction, applicationUserID)
	if err != nil {
		return apiService.DeletionResult{}, err
	}
	for _, email := range emailLocks {
		if err := postgres.LockPasswordlessEmail(ctx, transaction, email); err != nil {
			return apiService.DeletionResult{}, err
		}
	}
	if err := lockDeletionUsers(ctx, transaction, applicationUserID, request.VaultDecisions); err != nil {
		return apiService.DeletionResult{}, err
	}
	challenge, err := loadDeletionAuthorization(ctx, transaction, applicationUserID, authorizationDigest, now)
	if err != nil {
		return apiService.DeletionResult{}, err
	}
	if challenge.completedDeletionID != nil {
		result, err := loadDeletionResult(ctx, transaction, *challenge.completedDeletionID)
		if err != nil {
			return apiService.DeletionResult{}, err
		}
		if err := transaction.Commit(ctx); err != nil {
			return apiService.DeletionResult{}, fmt.Errorf("commit idempotent account deletion: %w", err)
		}
		return result, nil
	}
	var userEmail string
	if err := transaction.QueryRow(ctx, `SELECT email FROM application_users WHERE id = $1 AND status = 'ACTIVE' FOR UPDATE`, applicationUserID).Scan(&userEmail); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return apiService.DeletionResult{}, apiService.ErrDeletionAuthorization
		}
		return apiService.DeletionResult{}, fmt.Errorf("load account deletion user: %w", err)
	}
	identities, err := loadDeletionIdentities(ctx, transaction, applicationUserID)
	if err != nil {
		return apiService.DeletionResult{}, err
	}
	personalVaultIDs, sharedVaults, activeMembershipVaultIDs, err := loadDeletionVaultState(ctx, transaction, applicationUserID)
	if err != nil {
		return apiService.DeletionResult{}, err
	}
	vaultIDsToLock := uniqueStrings(append(append(append([]string{}, personalVaultIDs...), activeMembershipVaultIDs...), sharedVaultIDsAsIDs(sharedVaults)...))
	if err := lockDeletionVaults(ctx, transaction, vaultIDsToLock); err != nil {
		return apiService.DeletionResult{}, err
	}
	sharedVaults, err = loadOwnedSharedVaults(ctx, transaction, applicationUserID)
	if err != nil {
		return apiService.DeletionResult{}, err
	}
	decisions, err := validateVaultDecisionPlan(sharedVaults, request.VaultDecisions)
	if err != nil {
		return apiService.DeletionResult{}, err
	}
	deletedSharedVaultIDs := make([]string, 0, len(sharedVaults))
	transferredSharedVaultIDs := make([]string, 0, len(sharedVaults))
	for _, vault := range sharedVaults {
		decision := decisions[vault.ID]
		if decision.Action == apiService.VaultActionDelete {
			deletedSharedVaultIDs = append(deletedSharedVaultIDs, vault.ID)
			continue
		}
		if vault.Lifecycle != "ACTIVE" || decision.TransferToUserID.Value == applicationUserID {
			return apiService.DeletionResult{}, apiService.ErrDeletionPlanStale
		}
		if err := transferOwnedSharedVault(ctx, transaction, applicationUserID, vault.ID, decision.TransferToUserID.Value, now); err != nil {
			return apiService.DeletionResult{}, err
		}
		transferredSharedVaultIDs = append(transferredSharedVaultIDs, vault.ID)
	}
	deletedVaultIDs := uniqueStrings(append(append([]string{}, personalVaultIDs...), deletedSharedVaultIDs...))
	var authenticatorAccountCount int
	if err := transaction.QueryRow(ctx, `SELECT COUNT(*) FROM authenticator_accounts WHERE vault_id = ANY($1::text[])`, deletedVaultIDs).Scan(&authenticatorAccountCount); err != nil {
		return apiService.DeletionResult{}, fmt.Errorf("count deleted account vaults: %w", err)
	}
	recordID, err := postgres.NewCUID()
	if err != nil {
		return apiService.DeletionResult{}, fmt.Errorf("generate account deletion receipt ID: %w", err)
	}
	if err := insertDeletionLedger(ctx, transaction, recordID, applicationUserID, userEmail, identities, now, len(personalVaultIDs), len(deletedSharedVaultIDs), len(transferredSharedVaultIDs), authenticatorAccountCount); err != nil {
		return apiService.DeletionResult{}, err
	}
	if err := removeDeletionVaultData(ctx, transaction, applicationUserID, userEmail, identities, deletedVaultIDs); err != nil {
		return apiService.DeletionResult{}, err
	}
	if err := repository.removeDeletionIdentityData(ctx, transaction, applicationUserID, userEmail, identities); err != nil {
		return apiService.DeletionResult{}, err
	}
	if _, err := transaction.Exec(ctx, `DELETE FROM account_deletion_challenges WHERE application_user_id = $1 AND id <> $2`, applicationUserID, challenge.id); err != nil {
		return apiService.DeletionResult{}, fmt.Errorf("remove old account deletion challenges: %w", err)
	}
	if _, err := transaction.Exec(ctx, `DELETE FROM application_users WHERE id = $1`, applicationUserID); err != nil {
		return apiService.DeletionResult{}, fmt.Errorf("delete application user: %w", err)
	}
	if _, err := transaction.Exec(ctx, `UPDATE account_deletion_challenges SET consumed_at = $2, completed_deletion_id = $3 WHERE id = $1`, challenge.id, now, recordID); err != nil {
		return apiService.DeletionResult{}, fmt.Errorf("retain account deletion authorization receipt: %w", err)
	}
	metricID, err := postgres.NewCUID()
	if err != nil {
		return apiService.DeletionResult{}, fmt.Errorf("generate account deletion metric ID: %w", err)
	}
	if _, err := transaction.Exec(ctx, `
		INSERT INTO account_deletion_metrics
			(id, auth_backend, personal_vault_count, shared_vault_deleted_count, shared_vault_transferred_count, authenticator_account_count, occurred_at)
		VALUES ($1, 'passwordless', $2, $3, $4, $5, $6)`,
		metricID, len(personalVaultIDs), len(deletedSharedVaultIDs), len(transferredSharedVaultIDs), authenticatorAccountCount, now); err != nil {
		return apiService.DeletionResult{}, fmt.Errorf("record account deletion metric: %w", err)
	}
	if err := transaction.Commit(ctx); err != nil {
		return apiService.DeletionResult{}, fmt.Errorf("commit account deletion transaction: %w", err)
	}
	return apiService.DeletionResult{
		ReceiptID:                   recordID,
		Email:                       userEmail,
		EmailDelivery:               "pending",
		PersonalVaultCount:          len(personalVaultIDs),
		SharedVaultDeletedCount:     len(deletedSharedVaultIDs),
		SharedVaultTransferredCount: len(transferredSharedVaultIDs),
		AuthenticatorAccountCount:   authenticatorAccountCount,
	}, nil
}

func (repository *DeletionRepository) RecordCompletionEmailStatus(ctx context.Context, receiptID string, status string) error {
	if status != "SENT" && status != "FAILED" {
		return errors.New("account deletion email delivery status is invalid")
	}
	result, err := repository.pool.Exec(ctx, `UPDATE account_deletion_records SET email_delivery_status = $2 WHERE id = $1`, receiptID, status)
	if err != nil {
		return fmt.Errorf("record account deletion completion email status: %w", err)
	}
	if result.RowsAffected() != 1 {
		return errors.New("account deletion receipt is unavailable")
	}
	return nil
}

type deletionChallenge struct {
	id                  string
	completedDeletionID *string
}

func loadDeletionEmailLocks(ctx context.Context, transaction pgx.Tx, userID string) ([]string, error) {
	rows, err := transaction.Query(ctx, `
		SELECT lower(trim(application_user.email)) AS normalized_email
		FROM application_users AS application_user
		WHERE application_user.id = $1 AND trim(application_user.email) <> ''
		UNION
		SELECT lower(trim(identity.email))
		FROM external_identities AS identity
		WHERE identity.application_user_id = $1 AND identity.email IS NOT NULL AND trim(identity.email) <> ''
		UNION
		SELECT passwordless.normalized_email
		FROM passwordless_identities AS passwordless
		JOIN external_identities AS identity ON identity.id = passwordless.external_identity_id
		WHERE identity.application_user_id = $1
		ORDER BY 1`, userID)
	if err != nil {
		return nil, fmt.Errorf("load passwordless admission locks for account deletion: %w", err)
	}
	defer rows.Close()
	emails := make([]string, 0)
	for rows.Next() {
		var email string
		if err := rows.Scan(&email); err != nil {
			return nil, fmt.Errorf("scan passwordless admission locks for account deletion: %w", err)
		}
		emails = append(emails, email)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate passwordless admission locks for account deletion: %w", err)
	}
	return emails, nil
}

func loadDeletionAuthorization(ctx context.Context, transaction pgx.Tx, userID string, digest []byte, now time.Time) (deletionChallenge, error) {
	var challenge deletionChallenge
	var ownerID string
	var verifiedAt *time.Time
	var expiresAt time.Time
	err := transaction.QueryRow(ctx, `
		SELECT id, application_user_id, verified_at, expires_at, completed_deletion_id
		FROM account_deletion_challenges WHERE authorization_digest = $1 FOR UPDATE`, digest).Scan(
		&challenge.id, &ownerID, &verifiedAt, &expiresAt, &challenge.completedDeletionID,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return deletionChallenge{}, apiService.ErrDeletionAuthorization
	}
	if err != nil {
		return deletionChallenge{}, fmt.Errorf("load account deletion authorization: %w", err)
	}
	if ownerID != userID || verifiedAt == nil || expiresAt.Before(now) || expiresAt.Equal(now) {
		return deletionChallenge{}, apiService.ErrDeletionAuthorization
	}
	return challenge, nil
}

func loadDeletionResult(ctx context.Context, queryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, receiptID string) (apiService.DeletionResult, error) {
	var result apiService.DeletionResult
	err := queryer.QueryRow(ctx, `
		SELECT id, email, email_delivery_status, personal_vault_count, shared_vault_deleted_count,
			shared_vault_transferred_count, authenticator_account_count
		FROM account_deletion_records WHERE id = $1`, receiptID).Scan(
		&result.ReceiptID, &result.Email, &result.EmailDelivery,
		&result.PersonalVaultCount, &result.SharedVaultDeletedCount,
		&result.SharedVaultTransferredCount, &result.AuthenticatorAccountCount,
	)
	if err != nil {
		return apiService.DeletionResult{}, fmt.Errorf("load account deletion receipt: %w", err)
	}
	result.EmailDelivery = normalizeEmailDeliveryStatus(result.EmailDelivery)
	return result, nil
}

func loadDeletionIdentities(ctx context.Context, transaction pgx.Tx, userID string) ([]deletionIdentity, error) {
	rows, err := transaction.Query(ctx, `SELECT issuer, subject, email FROM external_identities WHERE application_user_id = $1 ORDER BY issuer, subject`, userID)
	if err != nil {
		return nil, fmt.Errorf("load application user identities for deletion: %w", err)
	}
	defer rows.Close()
	identities := make([]deletionIdentity, 0)
	for rows.Next() {
		var identity deletionIdentity
		if err := rows.Scan(&identity.issuer, &identity.subject, &identity.email); err != nil {
			return nil, fmt.Errorf("scan application user identity for deletion: %w", err)
		}
		identities = append(identities, identity)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate application user identities for deletion: %w", err)
	}
	return identities, nil
}

type deletionIdentity struct {
	issuer  string
	subject string
	email   *string
}

type deletionVault struct {
	ID        string
	Lifecycle string
}

func loadDeletionVaultState(ctx context.Context, transaction pgx.Tx, userID string) ([]string, []deletionVault, []string, error) {
	personalRows, err := transaction.Query(ctx, `SELECT id FROM vaults WHERE owner_id = $1 AND type = 'PERSONAL' ORDER BY id`, userID)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("load Personal Vaults for deletion: %w", err)
	}
	personalVaultIDs, err := collectIDs(personalRows)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("iterate Personal Vaults for deletion: %w", err)
	}
	sharedVaults, err := loadOwnedSharedVaults(ctx, transaction, userID)
	if err != nil {
		return nil, nil, nil, err
	}
	memberRows, err := transaction.Query(ctx, `
		SELECT DISTINCT member.vault_id
		FROM vault_members AS member JOIN vaults AS vault ON vault.id = member.vault_id
		WHERE member.user_id = $1 AND member.status = 'ACTIVE' AND vault.type = 'SHARED'
		ORDER BY member.vault_id`, userID)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("load active Shared Vault memberships for deletion: %w", err)
	}
	membershipVaultIDs, err := collectIDs(memberRows)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("iterate Shared Vault memberships for deletion: %w", err)
	}
	return personalVaultIDs, sharedVaults, membershipVaultIDs, nil
}

func loadOwnedSharedVaults(ctx context.Context, transaction pgx.Tx, userID string) ([]deletionVault, error) {
	rows, err := transaction.Query(ctx, `SELECT id, lifecycle FROM vaults WHERE owner_id = $1 AND type = 'SHARED' ORDER BY id`, userID)
	if err != nil {
		return nil, fmt.Errorf("load owned Shared Vaults for deletion: %w", err)
	}
	defer rows.Close()
	vaults := make([]deletionVault, 0)
	for rows.Next() {
		var vault deletionVault
		if err := rows.Scan(&vault.ID, &vault.Lifecycle); err != nil {
			return nil, fmt.Errorf("scan owned Shared Vault for deletion: %w", err)
		}
		vaults = append(vaults, vault)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate owned Shared Vaults for deletion: %w", err)
	}
	return vaults, nil
}

func lockDeletionUsers(ctx context.Context, transaction pgx.Tx, ownerID string, decisions []apiService.VaultDecision) error {
	userIDs := []string{ownerID}
	for _, decision := range decisions {
		if decision.Action == apiService.VaultActionTransfer && decision.TransferToUserID.Present {
			userIDs = append(userIDs, decision.TransferToUserID.Value)
		}
	}
	for _, userID := range uniqueStrings(userIDs) {
		if _, err := transaction.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, userID); err != nil {
			return fmt.Errorf("lock account deletion user: %w", err)
		}
	}
	return nil
}

func lockDeletionVaults(ctx context.Context, transaction pgx.Tx, vaultIDs []string) error {
	if len(vaultIDs) == 0 {
		return nil
	}
	rows, err := transaction.Query(ctx, `SELECT id FROM vaults WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE`, vaultIDs)
	if err != nil {
		return fmt.Errorf("lock Vaults for account deletion: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return fmt.Errorf("scan Vault lock for account deletion: %w", err)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate Vault locks for account deletion: %w", err)
	}
	return nil
}

func validateVaultDecisionPlan(vaults []deletionVault, vaultDecisions []apiService.VaultDecision) (map[string]apiService.VaultDecision, error) {
	if len(vaults) != len(vaultDecisions) {
		return nil, apiService.ErrDeletionPlanStale
	}
	decisions := make(map[string]apiService.VaultDecision, len(vaultDecisions))
	for _, decision := range vaultDecisions {
		decisions[decision.VaultID] = decision
	}
	for _, vault := range vaults {
		if _, exists := decisions[vault.ID]; !exists {
			return nil, apiService.ErrDeletionPlanStale
		}
	}
	return decisions, nil
}

func transferOwnedSharedVault(ctx context.Context, transaction pgx.Tx, deletingUserID string, vaultID string, targetUserID string, now time.Time) error {
	var active bool
	if err := transaction.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM application_users WHERE id = $1 AND status = 'ACTIVE')`, targetUserID).Scan(&active); err != nil {
		return fmt.Errorf("check Shared Vault transfer target: %w", err)
	}
	if !active {
		return apiService.ErrDeletionPlanStale
	}
	var targetRole string
	var targetStatus string
	var encryptedVaultKey []byte
	var keyVersion *int
	err := transaction.QueryRow(ctx, `
		SELECT role, status, encrypted_vault_key, key_version FROM vault_members
		WHERE vault_id = $1 AND user_id = $2`, vaultID, targetUserID).Scan(&targetRole, &targetStatus, &encryptedVaultKey, &keyVersion)
	if errors.Is(err, pgx.ErrNoRows) {
		return apiService.ErrDeletionPlanStale
	}
	if err != nil {
		return fmt.Errorf("load Shared Vault transfer membership: %w", err)
	}
	if targetRole != "VIEWER" || targetStatus != "ACTIVE" || len(encryptedVaultKey) == 0 || keyVersion == nil || *keyVersion == 0 {
		return apiService.ErrDeletionPlanStale
	}
	result, err := transaction.Exec(ctx, `
		UPDATE vault_members
		SET role = 'OWNER', can_add_accounts_override = NULL, can_edit_accounts_override = NULL,
			can_delete_accounts_override = NULL, permissions_revision = permissions_revision + 1, updated_at = $3
		WHERE vault_id = $1 AND user_id = $2 AND role = 'VIEWER' AND status = 'ACTIVE'`, vaultID, targetUserID, now)
	if err != nil {
		return fmt.Errorf("promote Shared Vault transfer target: %w", err)
	}
	if result.RowsAffected() != 1 {
		return apiService.ErrDeletionPlanStale
	}
	result, err = transaction.Exec(ctx, `UPDATE vaults SET owner_id = $2, updated_at = $3 WHERE id = $1 AND owner_id = $4`, vaultID, targetUserID, now, deletingUserID)
	if err != nil {
		return fmt.Errorf("transfer Shared Vault ownership: %w", err)
	}
	if result.RowsAffected() != 1 {
		return apiService.ErrDeletionPlanStale
	}
	return nil
}

func insertDeletionLedger(ctx context.Context, transaction pgx.Tx, recordID string, userID string, email string, identities []deletionIdentity, now time.Time, personalCount int, deletedSharedCount int, transferredSharedCount int, accountCount int) error {
	if _, err := transaction.Exec(ctx, `
		INSERT INTO account_deletion_records
			(id, application_user_id, email, auth_backend, requested_at, completed_at, email_delivery_status,
			 personal_vault_count, shared_vault_deleted_count, shared_vault_transferred_count, authenticator_account_count)
		VALUES ($1, $2, $3, 'passwordless', $4, $4, 'PENDING', $5, $6, $7, $8)`,
		recordID, userID, email, now, personalCount, deletedSharedCount, transferredSharedCount, accountCount); err != nil {
		return fmt.Errorf("record account deletion receipt: %w", err)
	}
	for _, identity := range identities {
		identityID, err := postgres.NewCUID()
		if err != nil {
			return fmt.Errorf("generate account deletion identity ID: %w", err)
		}
		var normalizedEmail *string
		if identity.email != nil {
			value := strings.ToLower(*identity.email)
			normalizedEmail = &value
		}
		if _, err := transaction.Exec(ctx, `
			INSERT INTO account_deletion_identities (id, deletion_record_id, issuer, subject, normalized_email, deleted_at)
			VALUES ($1, $2, $3, $4, $5, $6)`, identityID, recordID, identity.issuer, identity.subject, normalizedEmail, now); err != nil {
			return fmt.Errorf("record deleted account identity tombstone: %w", err)
		}
	}
	return nil
}

func removeDeletionVaultData(ctx context.Context, transaction pgx.Tx, userID string, email string, identities []deletionIdentity, deletedVaultIDs []string) error {
	emails := deletionIdentityEmails(email, identities)
	queries := []struct {
		query string
		args  []any
	}{
		{`DELETE FROM vault_audit_events WHERE actor_user_id = $1 OR owner_id = $1 OR target_id = $1 OR vault_id = ANY($2::text[])`, []any{userID, deletedVaultIDs}},
		{`DELETE FROM vault_invitations WHERE recipient_user_id = $1 OR LOWER(recipient_email) = ANY($2::text[]) OR vault_id = ANY($3::text[])`, []any{userID, emails, deletedVaultIDs}},
		{`DELETE FROM vault_members WHERE user_id = $1 OR vault_id = ANY($2::text[])`, []any{userID, deletedVaultIDs}},
		{`DELETE FROM authenticator_accounts WHERE vault_id = ANY($1::text[])`, []any{deletedVaultIDs}},
		{`DELETE FROM vaults WHERE id = ANY($1::text[])`, []any{deletedVaultIDs}},
	}
	for _, operation := range queries {
		if _, err := transaction.Exec(ctx, operation.query, operation.args...); err != nil {
			return fmt.Errorf("remove account deletion Vault data: %w", err)
		}
	}
	return nil
}

func (repository *DeletionRepository) removeDeletionIdentityData(ctx context.Context, transaction pgx.Tx, userID string, email string, identities []deletionIdentity) error {
	emails := deletionIdentityEmails(email, identities)
	if err := repository.removeAnonymousAuthRateLimits(ctx, transaction, emails); err != nil {
		return err
	}
	if _, err := transaction.Exec(ctx, `
		DELETE FROM pwa_authentication_handoffs
		WHERE session_id IN (SELECT id FROM auth_sessions WHERE application_user_id = $1)
			OR normalized_email = ANY($2::text[])`, userID, emails); err != nil {
		return fmt.Errorf("remove passwordless handoffs for deleted user: %w", err)
	}
	if _, err := transaction.Exec(ctx, `DELETE FROM magic_link_challenges WHERE normalized_email = ANY($1::text[])`, emails); err != nil {
		return fmt.Errorf("remove magic-link challenges for deleted user: %w", err)
	}
	if _, err := transaction.Exec(ctx, `DELETE FROM passkey_recovery_challenges WHERE user_id = $1`, userID); err != nil {
		return fmt.Errorf("remove passkey recovery challenges for deleted user: %w", err)
	}
	if _, err := transaction.Exec(ctx, `DELETE FROM passkey_recovery_credentials WHERE user_id = $1`, userID); err != nil {
		return fmt.Errorf("remove passkey recovery credentials for deleted user: %w", err)
	}
	if _, err := transaction.Exec(ctx, `DELETE FROM user_crypto_profiles WHERE user_id = $1`, userID); err != nil {
		return fmt.Errorf("remove user crypto profile for deleted user: %w", err)
	}
	if _, err := transaction.Exec(ctx, `DELETE FROM application_rate_limit_windows WHERE user_id = $1`, userID); err != nil {
		return fmt.Errorf("remove application rate limits for deleted user: %w", err)
	}
	if _, err := transaction.Exec(ctx, `DELETE FROM identity_security_events WHERE application_user_id = $1`, userID); err != nil {
		return fmt.Errorf("remove security events for deleted user: %w", err)
	}
	if _, err := transaction.Exec(ctx, `DELETE FROM auth_sessions WHERE application_user_id = $1`, userID); err != nil {
		return fmt.Errorf("remove sessions for deleted user: %w", err)
	}
	return nil
}

func (repository *DeletionRepository) removeAnonymousAuthRateLimits(ctx context.Context, transaction pgx.Tx, emails []string) error {
	buckets := make([][]byte, 0, len(emails))
	for _, email := range emails {
		mac := hmac.New(sha256.New, repository.anonymousAuthSecret)
		_, _ = mac.Write([]byte("magic-link-email:" + email))
		buckets = append(buckets, mac.Sum(nil))
	}
	if len(buckets) == 0 {
		return nil
	}
	if _, err := transaction.Exec(ctx, `DELETE FROM anonymous_auth_rate_limit_windows WHERE operation = 'magic-link-email' AND bucket_hash = ANY($1::bytea[])`, buckets); err != nil {
		return fmt.Errorf("remove anonymous email rate limits for deleted user: %w", err)
	}
	for _, bucket := range buckets {
		clear(bucket)
	}
	return nil
}

func deletionIdentityEmails(email string, identities []deletionIdentity) []string {
	emails := []string{strings.ToLower(email)}
	for _, identity := range identities {
		if identity.email != nil {
			emails = append(emails, strings.ToLower(*identity.email))
		}
	}
	return uniqueStrings(emails)
}

func sharedVaultIDsAsIDs(vaults []deletionVault) []string {
	ids := make([]string, 0, len(vaults))
	for _, vault := range vaults {
		ids = append(ids, vault.ID)
	}
	return ids
}

func collectIDs(rows pgx.Rows) ([]string, error) {
	defer rows.Close()
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	unique := make([]string, 0, len(values))
	for _, value := range values {
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		unique = append(unique, value)
	}
	sort.Strings(unique)
	return unique
}

func normalizeEmailDeliveryStatus(status string) string {
	if status == "SENT" {
		return "sent"
	}
	return "failed"
}

func (repository *DeletionRepository) digest(context string, value string) []byte {
	mac := hmac.New(sha256.New, repository.sessionSecret)
	_, _ = mac.Write([]byte(context))
	_, _ = mac.Write([]byte(value))
	return mac.Sum(nil)
}

func validAccountDeletionToken(token string) bool {
	if len(token) < 43 || len(token) > 128 {
		return false
	}
	for _, character := range token {
		if character >= 'A' && character <= 'Z' || character >= 'a' && character <= 'z' || character >= '0' && character <= '9' || character == '_' || character == '-' {
			continue
		}
		return false
	}
	return true
}

var _ apiService.DeletionRepository = (*DeletionRepository)(nil)
