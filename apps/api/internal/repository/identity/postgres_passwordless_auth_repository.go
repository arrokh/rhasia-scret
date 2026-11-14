package infrastructure

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/postgres"
	identityapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/service/identity"
)

type PostgresPasswordlessAuthRepository struct {
	pool          *pgxpool.Pool
	configuration identityapp.PasswordlessConfiguration
}

func NewPostgresPasswordlessAuthRepository(pool *pgxpool.Pool, configuration identityapp.PasswordlessConfiguration) (*PostgresPasswordlessAuthRepository, error) {
	if pool == nil || len(configuration.MagicLinkSecret) < 32 || len(configuration.SessionSecret) < 32 {
		return nil, errors.New("passwordless authentication repository is not configured")
	}
	return &PostgresPasswordlessAuthRepository{pool: pool, configuration: configuration}, nil
}

func (repository *PostgresPasswordlessAuthRepository) CreateChallenge(ctx context.Context, tokenDigest []byte, challenge identityapp.MagicLinkChallenge, expiresAt time.Time, handoff *identityapp.PWAHandoffChallenge) error {
	challengeID, err := postgres.NewCUID()
	if err != nil {
		return err
	}
	transaction, err := repository.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin magic-link challenge transaction: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()

	_, err = transaction.Exec(ctx, `
		INSERT INTO magic_link_challenges (
			id, normalized_email, purpose, token_digest, client, return_path, expires_at
		)
		VALUES ($1, $2, 'sign_in', $3, $4, $5, $6)`, challengeID, challenge.Email, tokenDigest, string(challenge.Client), string(challenge.ReturnPath), expiresAt)
	if err != nil {
		return fmt.Errorf("insert magic-link challenge: %w", err)
	}
	if handoff != nil {
		handoffID, idErr := postgres.NewCUID()
		if idErr != nil {
			return idErr
		}
		_, err = transaction.Exec(ctx, `
			INSERT INTO pwa_authentication_handoffs (
				id, handoff_id_digest, verifier_digest, normalized_email, return_path, expires_at
			)
			VALUES ($1, $2, $3, $4, $5, $6)`, handoffID, handoff.IDDigest, handoff.VerifierDigest, challenge.Email, string(challenge.ReturnPath), handoff.ExpiresAt)
		if err != nil {
			return fmt.Errorf("insert PWA authentication handoff: %w", err)
		}
	}
	if err := transaction.Commit(ctx); err != nil {
		return fmt.Errorf("commit magic-link challenge: %w", err)
	}
	return nil
}

func (repository *PostgresPasswordlessAuthRepository) ConsumeChallenge(ctx context.Context, tokenDigest []byte, client identityapp.PasswordlessClient, now time.Time) (*identityapp.MagicLinkChallenge, error) {
	transaction, err := repository.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("begin magic-link redemption transaction: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()

	var candidate struct {
		ID         string
		Email      string
		Client     string
		ReturnPath string
		ExpiresAt  time.Time
		ConsumedAt *time.Time
		CreatedAt  time.Time
	}
	err = transaction.QueryRow(ctx, `
		SELECT id, normalized_email, client, return_path, expires_at, consumed_at, created_at
		FROM magic_link_challenges
		WHERE token_digest = $1
		FOR UPDATE`, tokenDigest).Scan(
		&candidate.ID,
		&candidate.Email,
		&candidate.Client,
		&candidate.ReturnPath,
		&candidate.ExpiresAt,
		&candidate.ConsumedAt,
		&candidate.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load magic-link challenge: %w", err)
	}
	if candidate.Client != string(client) || candidate.ConsumedAt != nil || !candidate.ExpiresAt.After(now) {
		return nil, nil
	}

	var deletedAt *time.Time
	err = transaction.QueryRow(ctx, `
		SELECT identity.deleted_at
		FROM account_deletion_identities AS identity
		JOIN account_deletion_records AS deletion ON deletion.id = identity.deletion_record_id
		WHERE identity.normalized_email = $1 AND deletion.completed_at >= $2
		ORDER BY identity.deleted_at DESC
		LIMIT 1`, candidate.Email, candidate.CreatedAt).Scan(&deletedAt)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("check completed account deletion before link redemption: %w", err)
	}
	if deletedAt != nil && !deletedAt.Before(candidate.CreatedAt) {
		return nil, nil
	}

	command, err := transaction.Exec(ctx, `
		UPDATE magic_link_challenges
		SET consumed_at = $2
		WHERE id = $1 AND client = $3 AND consumed_at IS NULL AND expires_at > $2`, candidate.ID, now, string(client))
	if err != nil {
		return nil, fmt.Errorf("consume magic-link challenge: %w", err)
	}
	if command.RowsAffected() != 1 {
		return nil, nil
	}
	if err := transaction.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit magic-link redemption: %w", err)
	}
	return &identityapp.MagicLinkChallenge{
		Email:      candidate.Email,
		Client:     client,
		ReturnPath: identityapp.PasswordlessReturnPath(candidate.ReturnPath),
		CreatedAt:  candidate.CreatedAt,
	}, nil
}

func (repository *PostgresPasswordlessAuthRepository) FindOrCreateAccount(ctx context.Context, email string, challengeCreatedAt time.Time, now time.Time) (identityapp.PasswordlessAccount, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" || challengeCreatedAt.IsZero() {
		return identityapp.PasswordlessAccount{}, errors.New("passwordless account admission is invalid")
	}
	transaction, err := repository.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return identityapp.PasswordlessAccount{}, fmt.Errorf("begin passwordless account admission: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	if err := postgres.LockPasswordlessEmail(ctx, transaction, email); err != nil {
		return identityapp.PasswordlessAccount{}, err
	}
	var deletedBeforeAdmission bool
	if err := transaction.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM account_deletion_identities AS identity
			JOIN account_deletion_records AS deletion ON deletion.id = identity.deletion_record_id
			WHERE identity.normalized_email = $1 AND deletion.completed_at >= $2
		)`, email, challengeCreatedAt).Scan(&deletedBeforeAdmission); err != nil {
		return identityapp.PasswordlessAccount{}, fmt.Errorf("check account deletion before passwordless admission: %w", err)
	}
	if deletedBeforeAdmission {
		return identityapp.PasswordlessAccount{}, identityapp.ErrCredentialInvalidated
	}

	account, err := repository.findPasswordlessAccount(ctx, transaction, email)
	if err == nil {
		if err := updatePasswordlessAccountInTransaction(ctx, transaction, account.ApplicationUserID, account.Subject, email, now); err != nil {
			return identityapp.PasswordlessAccount{}, err
		}
		account.Email = email
	} else {
		if !errors.Is(err, pgx.ErrNoRows) {
			return identityapp.PasswordlessAccount{}, fmt.Errorf("find passwordless account: %w", err)
		}
		account, err = repository.createPasswordlessAccountInTransaction(ctx, transaction, email, now)
		if err != nil {
			return identityapp.PasswordlessAccount{}, fmt.Errorf("create passwordless account: %w", err)
		}
	}
	if err := transaction.Commit(ctx); err != nil {
		return identityapp.PasswordlessAccount{}, fmt.Errorf("commit passwordless account admission: %w", err)
	}
	return account, nil
}

func (repository *PostgresPasswordlessAuthRepository) findPasswordlessAccount(ctx context.Context, queryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, email string) (identityapp.PasswordlessAccount, error) {
	var account identityapp.PasswordlessAccount
	err := queryer.QueryRow(ctx, `
		SELECT application_user.id, external.issuer, external.subject, passwordless.normalized_email
		FROM passwordless_identities AS passwordless
		JOIN external_identities AS external ON external.id = passwordless.external_identity_id
		JOIN application_users AS application_user ON application_user.id = external.application_user_id
		WHERE passwordless.normalized_email = $1`, email).Scan(
		&account.ApplicationUserID,
		&account.Issuer,
		&account.Subject,
		&account.Email,
	)
	return account, err
}

func (repository *PostgresPasswordlessAuthRepository) updatePasswordlessAccount(ctx context.Context, applicationUserID string, subject string, email string, now time.Time) error {
	transaction, err := repository.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin passwordless account update: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	if err := postgres.LockPasswordlessEmail(ctx, transaction, email); err != nil {
		return err
	}
	if err := updatePasswordlessAccountInTransaction(ctx, transaction, applicationUserID, subject, email, now); err != nil {
		return err
	}
	if err := transaction.Commit(ctx); err != nil {
		return fmt.Errorf("commit passwordless account update: %w", err)
	}
	return nil
}

func updatePasswordlessAccountInTransaction(ctx context.Context, transaction pgx.Tx, applicationUserID, subject, email string, now time.Time) error {
	identityUpdate, err := transaction.Exec(ctx, `
		UPDATE external_identities
		SET email = $3, email_verified_at = $4, updated_at = $4
		WHERE issuer = $1 AND subject = $2`, identityapp.PasswordlessIssuer, subject, email, now)
	if err != nil {
		return fmt.Errorf("update passwordless external identity: %w", err)
	}
	if identityUpdate.RowsAffected() != 1 {
		return errors.New("passwordless external identity no longer exists")
	}
	userUpdate, err := transaction.Exec(ctx, `
		UPDATE application_users
		SET email = $2, updated_at = $3
		WHERE id = $1`, applicationUserID, email, now)
	if err != nil {
		return fmt.Errorf("update passwordless application user: %w", err)
	}
	if userUpdate.RowsAffected() != 1 {
		return errors.New("passwordless application user no longer exists")
	}
	return nil
}

func (repository *PostgresPasswordlessAuthRepository) createPasswordlessAccountInTransaction(ctx context.Context, transaction pgx.Tx, email string, now time.Time) (identityapp.PasswordlessAccount, error) {
	userID, err := postgres.NewCUID()
	if err != nil {
		return identityapp.PasswordlessAccount{}, err
	}
	externalID, err := postgres.NewCUID()
	if err != nil {
		return identityapp.PasswordlessAccount{}, err
	}
	passwordlessID, err := postgres.NewCUID()
	if err != nil {
		return identityapp.PasswordlessAccount{}, err
	}
	subject, err := randomUUIDWithoutDashes()
	if err != nil {
		return identityapp.PasswordlessAccount{}, err
	}
	_, err = transaction.Exec(ctx, `
		INSERT INTO application_users (id, email, status, created_at, updated_at)
		VALUES ($1, $2, 'ACTIVE', $3, $3)`, userID, email, now)
	if err != nil {
		return identityapp.PasswordlessAccount{}, err
	}
	_, err = transaction.Exec(ctx, `
		INSERT INTO external_identities (
			id, application_user_id, issuer, subject, email, email_verified_at, created_at, updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $6, $6)`, externalID, userID, identityapp.PasswordlessIssuer, subject, email, now)
	if err != nil {
		return identityapp.PasswordlessAccount{}, err
	}
	_, err = transaction.Exec(ctx, `
		INSERT INTO passwordless_identities (id, external_identity_id, normalized_email, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $4)`, passwordlessID, externalID, email, now)
	if err != nil {
		return identityapp.PasswordlessAccount{}, err
	}
	return identityapp.PasswordlessAccount{ApplicationUserID: userID, Issuer: identityapp.PasswordlessIssuer, Subject: subject, Email: email}, nil
}

func (repository *PostgresPasswordlessAuthRepository) CreateSession(ctx context.Context, account identityapp.PasswordlessAccount, now time.Time) (identityapp.PasswordlessSession, error) {
	transaction, err := repository.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return identityapp.PasswordlessSession{}, fmt.Errorf("begin passwordless session creation: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	session, err := repository.createSessionInTransaction(ctx, transaction, account, now)
	if err != nil {
		return identityapp.PasswordlessSession{}, err
	}
	if err := transaction.Commit(ctx); err != nil {
		return identityapp.PasswordlessSession{}, fmt.Errorf("commit passwordless session creation: %w", err)
	}
	return session, nil
}

func (repository *PostgresPasswordlessAuthRepository) VerifyAccessToken(ctx context.Context, tokenDigest []byte, now time.Time) (*identityapp.Principal, error) {
	principal, err := repository.loadPrincipal(ctx, `
		WHERE session.access_token_digest = $1
		  AND session.revoked_at IS NULL
		  AND session.access_expires_at > $2
		  AND application_user.status = 'ACTIVE'
		  AND identity.email IS NOT NULL
		  AND identity.email_verified_at IS NOT NULL`, tokenDigest, now)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("verify passwordless access token: %w", err)
	}
	if _, err := repository.pool.Exec(ctx, `UPDATE auth_sessions SET last_used_at = $2, updated_at = $2 WHERE id = $1`, principal.SessionID, now); err != nil {
		return nil, fmt.Errorf("update passwordless session activity: %w", err)
	}
	return &principal, nil
}

func (repository *PostgresPasswordlessAuthRepository) VerifyBrowserSession(ctx context.Context, sessionID string, now time.Time) (*identityapp.Principal, error) {
	principal, err := repository.loadPrincipal(ctx, `
		WHERE session.id = $1
		  AND session.revoked_at IS NULL
		  AND session.refresh_expires_at > $2
		  AND application_user.status = 'ACTIVE'
		  AND identity.email IS NOT NULL
		  AND identity.email_verified_at IS NOT NULL`, sessionID, now)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("verify passwordless browser session: %w", err)
	}
	return &principal, nil
}

func (repository *PostgresPasswordlessAuthRepository) loadPrincipal(ctx context.Context, condition string, firstArgument any, now time.Time) (identityapp.Principal, error) {
	query := `
		SELECT session.id, session.refresh_expires_at, session.created_at,
		       identity.issuer, identity.subject, identity.email
		FROM auth_sessions AS session
		JOIN application_users AS application_user ON application_user.id = session.application_user_id
		JOIN external_identities AS identity ON identity.application_user_id = application_user.id AND identity.issuer = $3
		` + condition
	var principal identityapp.Principal
	err := repository.pool.QueryRow(ctx, query, firstArgument, now, identityapp.PasswordlessIssuer).Scan(
		&principal.SessionID,
		&principal.SessionExpiresAt,
		&principal.IssuedAt,
		&principal.Issuer,
		&principal.Subject,
		&principal.Email,
	)
	if err != nil {
		return identityapp.Principal{}, err
	}
	principal.EmailVerified = true
	principal.Assurance = identityapp.AssuranceActiveSession
	return principal, nil
}

func (repository *PostgresPasswordlessAuthRepository) RevokeSession(ctx context.Context, sessionID string, now time.Time, reason string) error {
	_, err := repository.pool.Exec(ctx, `
		UPDATE auth_sessions
		SET revoked_at = $2, revocation_reason = $3, updated_at = $2
		WHERE id = $1 AND revoked_at IS NULL`, sessionID, now, reason)
	if err != nil {
		return fmt.Errorf("revoke passwordless session: %w", err)
	}
	return nil
}

func (repository *PostgresPasswordlessAuthRepository) PublishPWAHandoff(ctx context.Context, tokenDigest []byte, sessionID string, handoffIDDigest []byte, now time.Time) (bool, error) {
	transaction, err := repository.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return false, fmt.Errorf("begin PWA handoff publication: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()

	var candidate struct {
		ApplicationUserID  string
		RefreshTokenDigest []byte
		RevokedAt          *time.Time
		RefreshExpiresAt   time.Time
		Email              *string
	}
	err = transaction.QueryRow(ctx, `
		SELECT session.application_user_id, session.refresh_token_digest, session.revoked_at, session.refresh_expires_at, identity.email
		FROM auth_sessions AS session
		JOIN application_users AS application_user ON application_user.id = session.application_user_id
		JOIN external_identities AS identity ON identity.application_user_id = application_user.id AND identity.issuer = $2
		WHERE session.id = $1`, sessionID, identityapp.PasswordlessIssuer).Scan(
		&candidate.ApplicationUserID,
		&candidate.RefreshTokenDigest,
		&candidate.RevokedAt,
		&candidate.RefreshExpiresAt,
		&candidate.Email,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("load PWA publisher session: %w", err)
	}
	if candidate.Email == nil || candidate.RevokedAt != nil || !candidate.RefreshExpiresAt.After(now) {
		return false, nil
	}
	if !hmac.Equal(tokenDigest, candidate.RefreshTokenDigest) {
		if err := repository.recordRefreshReuse(ctx, transaction, candidate.ApplicationUserID, sessionID, now); err != nil {
			return false, err
		}
		if err := transaction.Commit(ctx); err != nil {
			return false, fmt.Errorf("commit refresh-token reuse detection: %w", err)
		}
		return false, nil
	}

	var handoffRowID string
	err = transaction.QueryRow(ctx, `
		UPDATE pwa_authentication_handoffs
		SET session_id = $2
		WHERE handoff_id_digest = $1
		  AND normalized_email = lower(btrim($3))
		  AND session_id IS NULL
		  AND published_at IS NULL
		  AND consumed_at IS NULL
		  AND expires_at > $4
		RETURNING id`, handoffIDDigest, sessionID, *candidate.Email, now).Scan(&handoffRowID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("reserve PWA handoff for publisher session: %w", err)
	}

	rotated, err := repository.rotateRefreshTokenInTransaction(ctx, transaction, tokenDigest, sessionID, now)
	if err != nil {
		return false, err
	}
	if !rotated {
		if _, err := transaction.Exec(ctx, `
			UPDATE pwa_authentication_handoffs
			SET session_id = NULL
			WHERE id = $1 AND session_id = $2 AND published_at IS NULL AND consumed_at IS NULL`, handoffRowID, sessionID); err != nil {
			return false, fmt.Errorf("release PWA handoff reservation: %w", err)
		}
		if err := transaction.Commit(ctx); err != nil {
			return false, fmt.Errorf("commit PWA handoff reservation release: %w", err)
		}
		return false, nil
	}
	var publishedID string
	err = transaction.QueryRow(ctx, `
		UPDATE pwa_authentication_handoffs
		SET published_at = $3
		WHERE id = $1 AND session_id = $2 AND published_at IS NULL AND consumed_at IS NULL
		RETURNING id`, handoffRowID, sessionID, now).Scan(&publishedID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, errors.New("PWA authentication handoff publication lost its reservation")
	}
	if err != nil {
		return false, fmt.Errorf("mark PWA handoff published: %w", err)
	}
	if err := transaction.Commit(ctx); err != nil {
		return false, fmt.Errorf("commit PWA handoff publication: %w", err)
	}
	return true, nil
}

func (repository *PostgresPasswordlessAuthRepository) RedeemPWAHandoff(ctx context.Context, handoffIDDigest []byte, verifierDigest []byte, now time.Time) (*identityapp.PasswordlessSession, identityapp.PasswordlessReturnPath, error) {
	transaction, err := repository.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, "", fmt.Errorf("begin PWA handoff redemption: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()

	var candidate struct {
		HandoffID         string
		VerifierDigest    []byte
		SessionID         *string
		ReturnPath        string
		ExpiresAt         time.Time
		PublishedAt       *time.Time
		ConsumedAt        *time.Time
		ApplicationUserID *string
		RefreshExpiresAt  *time.Time
		SessionRevokedAt  *time.Time
		UserStatus        *string
		Subject           *string
		Email             *string
		EmailVerifiedAt   *time.Time
	}
	err = transaction.QueryRow(ctx, `
		SELECT handoff.id, handoff.verifier_digest, handoff.session_id, handoff.return_path,
		       handoff.expires_at, handoff.published_at, handoff.consumed_at,
		       session.application_user_id, session.refresh_expires_at, session.revoked_at,
		       application_user.status, identity.subject, identity.email, identity.email_verified_at
		FROM pwa_authentication_handoffs AS handoff
		LEFT JOIN auth_sessions AS session ON session.id = handoff.session_id
		LEFT JOIN application_users AS application_user ON application_user.id = session.application_user_id
		LEFT JOIN external_identities AS identity ON identity.application_user_id = application_user.id AND identity.issuer = $2
		WHERE handoff.handoff_id_digest = $1
		FOR UPDATE OF handoff`, handoffIDDigest, identityapp.PasswordlessIssuer).Scan(
		&candidate.HandoffID,
		&candidate.VerifierDigest,
		&candidate.SessionID,
		&candidate.ReturnPath,
		&candidate.ExpiresAt,
		&candidate.PublishedAt,
		&candidate.ConsumedAt,
		&candidate.ApplicationUserID,
		&candidate.RefreshExpiresAt,
		&candidate.SessionRevokedAt,
		&candidate.UserStatus,
		&candidate.Subject,
		&candidate.Email,
		&candidate.EmailVerifiedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, "", nil
	}
	if err != nil {
		return nil, "", fmt.Errorf("load PWA authentication handoff: %w", err)
	}
	if !hmac.Equal(candidate.VerifierDigest, verifierDigest) ||
		candidate.SessionID == nil ||
		candidate.PublishedAt == nil ||
		candidate.ConsumedAt != nil ||
		!candidate.ExpiresAt.After(now) ||
		candidate.ApplicationUserID == nil ||
		candidate.RefreshExpiresAt == nil ||
		!candidate.RefreshExpiresAt.After(now) ||
		candidate.SessionRevokedAt != nil ||
		candidate.UserStatus == nil ||
		*candidate.UserStatus != "ACTIVE" ||
		candidate.Subject == nil ||
		candidate.Email == nil ||
		candidate.EmailVerifiedAt == nil {
		return nil, "", nil
	}

	command, err := transaction.Exec(ctx, `
		UPDATE pwa_authentication_handoffs
		SET consumed_at = $2
		WHERE id = $1 AND consumed_at IS NULL AND published_at IS NOT NULL AND expires_at > $2`, candidate.HandoffID, now)
	if err != nil {
		return nil, "", fmt.Errorf("consume PWA authentication handoff: %w", err)
	}
	if command.RowsAffected() != 1 {
		return nil, "", nil
	}
	account := identityapp.PasswordlessAccount{
		ApplicationUserID: *candidate.ApplicationUserID,
		Issuer:            identityapp.PasswordlessIssuer,
		Subject:           *candidate.Subject,
		Email:             *candidate.Email,
	}
	session, err := repository.createSessionInTransaction(ctx, transaction, account, now)
	if err != nil {
		return nil, "", err
	}
	if err := transaction.Commit(ctx); err != nil {
		return nil, "", fmt.Errorf("commit PWA authentication handoff redemption: %w", err)
	}
	return &session, identityapp.PasswordlessReturnPath(candidate.ReturnPath), nil
}

func (repository *PostgresPasswordlessAuthRepository) rotateRefreshTokenInTransaction(ctx context.Context, transaction pgx.Tx, tokenDigest []byte, sessionID string, now time.Time) (bool, error) {
	var session struct {
		ApplicationUserID string
		RefreshDigest     []byte
		RefreshExpiresAt  time.Time
		RevokedAt         *time.Time
		Status            string
		Issuer            string
		Subject           string
		Email             *string
		EmailVerifiedAt   *time.Time
		CreatedAt         time.Time
	}
	err := transaction.QueryRow(ctx, `
		SELECT session.application_user_id, session.refresh_token_digest, session.refresh_expires_at, session.revoked_at,
		       application_user.status, identity.issuer, identity.subject, identity.email, identity.email_verified_at, session.created_at
		FROM auth_sessions AS session
		JOIN application_users AS application_user ON application_user.id = session.application_user_id
		JOIN external_identities AS identity ON identity.application_user_id = application_user.id AND identity.issuer = $2
		WHERE session.id = $1`, sessionID, identityapp.PasswordlessIssuer).Scan(
		&session.ApplicationUserID,
		&session.RefreshDigest,
		&session.RefreshExpiresAt,
		&session.RevokedAt,
		&session.Status,
		&session.Issuer,
		&session.Subject,
		&session.Email,
		&session.EmailVerifiedAt,
		&session.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("load session for refresh-token rotation: %w", err)
	}
	if session.RevokedAt != nil || !session.RefreshExpiresAt.After(now) || session.Status != "ACTIVE" || session.Email == nil || session.EmailVerifiedAt == nil {
		return false, nil
	}
	if !hmac.Equal(tokenDigest, session.RefreshDigest) {
		if err := repository.recordRefreshReuse(ctx, transaction, session.ApplicationUserID, sessionID, now); err != nil {
			return false, err
		}
		return false, nil
	}

	accessToken, err := createSessionCredential(sessionID)
	if err != nil {
		return false, err
	}
	refreshToken, err := createSessionCredential(sessionID)
	if err != nil {
		return false, err
	}
	accessExpiry := now.Add(time.Duration(repository.configuration.AccessTokenTTLSeconds) * time.Second)
	command, err := transaction.Exec(ctx, `
		UPDATE auth_sessions
		SET access_token_digest = $3,
		    refresh_token_digest = $4,
		    access_expires_at = $5,
		    refresh_rotated_at = $6,
		    last_used_at = $6,
		    updated_at = $6
		WHERE id = $1 AND refresh_token_digest = $2 AND revoked_at IS NULL`, sessionID, tokenDigest, repository.digestSessionToken(accessToken), repository.digestSessionToken(refreshToken), accessExpiry, now)
	if err != nil {
		return false, fmt.Errorf("rotate passwordless session tokens: %w", err)
	}
	if command.RowsAffected() != 1 {
		if err := repository.recordRefreshReuse(ctx, transaction, session.ApplicationUserID, sessionID, now); err != nil {
			return false, err
		}
		return false, nil
	}
	return true, nil
}

func (repository *PostgresPasswordlessAuthRepository) createSessionInTransaction(ctx context.Context, transaction pgx.Tx, account identityapp.PasswordlessAccount, now time.Time) (identityapp.PasswordlessSession, error) {
	sessionID, err := randomUUIDWithoutDashes()
	if err != nil {
		return identityapp.PasswordlessSession{}, err
	}
	accessToken, err := createSessionCredential(sessionID)
	if err != nil {
		return identityapp.PasswordlessSession{}, err
	}
	refreshToken, err := createSessionCredential(sessionID)
	if err != nil {
		return identityapp.PasswordlessSession{}, err
	}
	accessExpiry := now.Add(time.Duration(repository.configuration.AccessTokenTTLSeconds) * time.Second)
	refreshExpiry := now.Add(time.Duration(repository.configuration.RefreshTokenTTLSeconds) * time.Second)
	_, err = transaction.Exec(ctx, `
		INSERT INTO auth_sessions (
			id, application_user_id, access_token_digest, refresh_token_digest, refresh_family,
			access_expires_at, refresh_expires_at, created_at, updated_at
		)
		VALUES ($1, $2, $3, $4, $1, $5, $6, $7, $7)`, sessionID, account.ApplicationUserID, repository.digestSessionToken(accessToken), repository.digestSessionToken(refreshToken), accessExpiry, refreshExpiry, now)
	if err != nil {
		return identityapp.PasswordlessSession{}, fmt.Errorf("insert passwordless session: %w", err)
	}
	principal := identityapp.Principal{
		Issuer:           account.Issuer,
		Subject:          account.Subject,
		Email:            account.Email,
		EmailVerified:    true,
		Assurance:        identityapp.AssuranceActiveSession,
		SessionID:        sessionID,
		SessionExpiresAt: refreshExpiry,
		IssuedAt:         now,
	}
	return identityapp.PasswordlessSession{
		SessionID:        sessionID,
		AccessToken:      accessToken,
		RefreshToken:     refreshToken,
		AccessExpiresAt:  accessExpiry,
		RefreshExpiresAt: refreshExpiry,
		Principal:        principal,
	}, nil
}

func (repository *PostgresPasswordlessAuthRepository) recordRefreshReuse(ctx context.Context, transaction pgx.Tx, applicationUserID string, sessionID string, now time.Time) error {
	command, err := transaction.Exec(ctx, `
		UPDATE auth_sessions
		SET revoked_at = $2, revocation_reason = 'refresh_reuse_detected', reuse_detected_at = $2, updated_at = $2
		WHERE id = $1 AND revoked_at IS NULL`, sessionID, now)
	if err != nil {
		return fmt.Errorf("revoke reused passwordless session: %w", err)
	}
	if command.RowsAffected() != 1 {
		return nil
	}
	eventID, err := postgres.NewCUID()
	if err != nil {
		return err
	}
	_, err = transaction.Exec(ctx, `
		INSERT INTO identity_security_events (id, application_user_id, session_id, event_type, created_at)
		VALUES ($1, $2, $3, 'refresh_token_reuse_detected', $4)`, eventID, applicationUserID, sessionID, now)
	if err != nil {
		return fmt.Errorf("record passwordless refresh-token reuse: %w", err)
	}
	return nil
}

func (repository *PostgresPasswordlessAuthRepository) digestSessionToken(token string) []byte {
	mac := hmac.New(sha256.New, repository.configuration.SessionSecret)
	_, _ = mac.Write([]byte(token))
	return mac.Sum(nil)
}

func createSessionCredential(sessionID string) (string, error) {
	secret, err := randomBase64URL(32)
	if err != nil {
		return "", err
	}
	return sessionID + "." + secret, nil
}

func randomBase64URL(size int) (string, error) {
	value := make([]byte, size)
	if _, err := rand.Read(value); err != nil {
		clear(value)
		return "", fmt.Errorf("generate passwordless session credential: %w", err)
	}
	encoded := base64.RawURLEncoding.EncodeToString(value)
	clear(value)
	return encoded, nil
}

func randomUUIDWithoutDashes() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", fmt.Errorf("generate passwordless identity subject: %w", err)
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	return hex.EncodeToString(value[:]), nil
}

var _ identityapp.PasswordlessAuthRepository = (*PostgresPasswordlessAuthRepository)(nil)
