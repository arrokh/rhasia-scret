package infrastructure

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	identityapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/service/identity"
	sharedapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/shared/application"
)

type PostgresUserCryptoProfileRepository struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

func NewPostgresUserCryptoProfileRepository(pool *pgxpool.Pool, now func() time.Time) (*PostgresUserCryptoProfileRepository, error) {
	if pool == nil {
		return nil, errors.New("user crypto profile repository is not configured")
	}
	if now == nil {
		now = time.Now
	}
	return &PostgresUserCryptoProfileRepository{pool: pool, now: now}, nil
}

func (repository *PostgresUserCryptoProfileRepository) Get(ctx context.Context, userID string) (*identityapp.EncryptedUserCryptoProfile, error) {
	var profile identityapp.EncryptedUserCryptoProfile
	var publicKey []byte
	err := repository.pool.QueryRow(ctx, `
		SELECT vault_unlock_salt, wrapped_user_root_key, encrypted_personal_vault_key,
		       root_key_wrapping_version, user_encryption_public_key, encrypted_user_private_key
		FROM user_crypto_profiles
		WHERE user_id = $1`, userID).Scan(
		&profile.VaultUnlockSalt,
		&profile.WrappedUserRootKey,
		&profile.EncryptedPersonalVaultKey,
		&profile.EncryptionVersion,
		&publicKey,
		&profile.EncryptedUserPrivateKey,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load encrypted user crypto profile: %w", err)
	}
	if len(publicKey) > 0 {
		if strings.TrimSpace(string(publicKey)) != "null" {
			profile.UserEncryptionPublicKey = json.RawMessage(append([]byte(nil), publicKey...))
		}
		clear(publicKey)
	}
	return &profile, nil
}

func (repository *PostgresUserCryptoProfileRepository) Register(ctx context.Context, userID string, identity identityapp.UserEncryptionIdentity) (bool, error) {
	if userID == "" || identity.EncryptionVersion != 1 || !validEncryptedProfileBlob(identity.EncryptedPrivateKey) ||
		identityapp.ValidateUserEncryptionPublicKey(identity.PublicKey) != nil {
		return false, errors.New("user encryption identity is invalid")
	}
	publicKey, err := json.Marshal(identity.PublicKey)
	if err != nil {
		return false, errors.New("user encryption identity is invalid")
	}
	transaction, err := repository.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return false, fmt.Errorf("begin user encryption identity registration: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	if _, err := transaction.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, userID); err != nil {
		return false, fmt.Errorf("lock user encryption identity registration: %w", err)
	}
	command, err := transaction.Exec(ctx, `
		UPDATE user_crypto_profiles
		SET user_encryption_public_key = $2::jsonb,
		    encrypted_user_private_key = $3,
		    user_encryption_key_version = $4,
		    updated_at = $5
		WHERE user_id = $1
		  AND user_encryption_public_key IS NULL
		  AND encrypted_user_private_key IS NULL
		  AND user_encryption_key_version IS NULL`, userID, publicKey, identity.EncryptedPrivateKey, identity.EncryptionVersion, repository.now())
	if err != nil {
		return false, fmt.Errorf("register user encryption identity: %w", err)
	}
	if command.RowsAffected() == 1 {
		if err := transaction.Commit(ctx); err != nil {
			return false, fmt.Errorf("commit user encryption identity registration: %w", err)
		}
		return true, nil
	}
	var exists bool
	if err := transaction.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM user_crypto_profiles WHERE user_id = $1)`, userID).Scan(&exists); err != nil {
		return false, fmt.Errorf("check user crypto profile for identity registration: %w", err)
	}
	if !exists {
		return false, errors.New("user crypto profile does not exist")
	}
	if err := transaction.Commit(ctx); err != nil {
		return false, fmt.Errorf("commit user encryption identity conflict check: %w", err)
	}
	return false, nil
}

func (repository *PostgresUserCryptoProfileRepository) MigratePrivateKey(ctx context.Context, userID string, migration identityapp.UserEncryptionPrivateKeyMigration) (identityapp.UserEncryptionPrivateKeyMigrationResult, error) {
	if userID == "" || migration.ExpectedEnvelopeVersion != 1 || migration.ReplacementEnvelopeVersion != 2 ||
		migration.UserEncryptionKeyVersion < 1 || !validEncryptedPrivateKeyMigrationBlob(migration.EncryptedPrivateKey) ||
		migration.EncryptedPrivateKey[0] != byte(migration.ReplacementEnvelopeVersion) ||
		!validSHA256Digest(migration.ExpectedCiphertextDigest) || !validSHA256Digest(migration.ReplacementCiphertextDigest) ||
		!constantTimeBytesEqual([]byte(migration.OperationID), []byte(migration.ReplacementCiphertextDigest)) ||
		!constantTimeBytesEqual([]byte(sha256Base64URL(migration.EncryptedPrivateKey)), []byte(migration.ReplacementCiphertextDigest)) {
		return identityapp.UserEncryptionPrivateKeyMigrationConflict, nil
	}
	transaction, err := repository.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return "", fmt.Errorf("begin user encryption private-key migration: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	if _, err := transaction.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, userID); err != nil {
		return "", fmt.Errorf("lock user encryption private-key migration: %w", err)
	}
	var currentCiphertext []byte
	var currentVersion pgtype.Int4
	err = transaction.QueryRow(ctx, `
		SELECT encrypted_user_private_key, user_encryption_key_version
		FROM user_crypto_profiles
		WHERE user_id = $1
		FOR UPDATE`, userID).Scan(&currentCiphertext, &currentVersion)
	if errors.Is(err, pgx.ErrNoRows) {
		return identityapp.UserEncryptionPrivateKeyMigrationConflict, nil
	}
	if err != nil {
		return "", fmt.Errorf("load user encryption private-key migration source: %w", err)
	}
	defer clear(currentCiphertext)
	if !currentVersion.Valid || int(currentVersion.Int32) != migration.UserEncryptionKeyVersion {
		return identityapp.UserEncryptionPrivateKeyMigrationConflict, nil
	}
	if constantTimeBytesEqual(currentCiphertext, migration.EncryptedPrivateKey) {
		if err := transaction.Commit(ctx); err != nil {
			return "", fmt.Errorf("commit user encryption private-key migration replay: %w", err)
		}
		return identityapp.UserEncryptionPrivateKeyMigrationAlreadyCommitted, nil
	}
	if len(currentCiphertext) == 0 || currentCiphertext[0] != byte(migration.ExpectedEnvelopeVersion) ||
		!constantTimeBytesEqual([]byte(sha256Base64URL(currentCiphertext)), []byte(migration.ExpectedCiphertextDigest)) {
		return identityapp.UserEncryptionPrivateKeyMigrationConflict, nil
	}
	command, err := transaction.Exec(ctx, `
		UPDATE user_crypto_profiles
		SET encrypted_user_private_key = $2,
		    updated_at = $3
		WHERE user_id = $1
		  AND encrypted_user_private_key = $4
		  AND user_encryption_key_version = $5`,
		userID, migration.EncryptedPrivateKey, repository.now(), currentCiphertext, migration.UserEncryptionKeyVersion)
	if err != nil {
		return "", fmt.Errorf("update encrypted user private-key backup: %w", err)
	}
	if command.RowsAffected() != 1 {
		return identityapp.UserEncryptionPrivateKeyMigrationConflict, nil
	}
	if err := transaction.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit user encryption private-key migration: %w", err)
	}
	return identityapp.UserEncryptionPrivateKeyMigrationCommitted, nil
}

func validEncryptedPrivateKeyMigrationBlob(value []byte) bool {
	return len(value) >= 30 && len(value) <= httpapiMaxEncryptedBlobBytes
}

const httpapiMaxEncryptedBlobBytes = 16*1024 + 29

func validSHA256Digest(value string) bool {
	return sharedapp.IsCanonicalSHA256Base64URLDigest(value)
}

func sha256Base64URL(value []byte) string {
	return sharedapp.SHA256Base64URL(value)
}

func (repository *PostgresUserCryptoProfileRepository) RewrapUserRootKey(ctx context.Context, userID string, rewrap identityapp.UserRootKeyRewrap) error {
	if userID == "" || len(rewrap.VaultUnlockSalt) != 16 || !validEncryptedProfileBlob(rewrap.WrappedUserRootKey) || rewrap.EncryptionVersion != 1 {
		return errors.New("user crypto profile rewrap is invalid")
	}
	if rewrap.EncryptedPersonalVaultKey != nil && !validEncryptedProfileBlob(rewrap.EncryptedPersonalVaultKey) {
		return errors.New("user crypto profile rewrap is invalid")
	}
	transaction, err := repository.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin user crypto profile rewrap: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	if _, err := transaction.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, userID); err != nil {
		return fmt.Errorf("lock user crypto profile rewrap: %w", err)
	}
	command, err := transaction.Exec(ctx, `
		UPDATE user_crypto_profiles
		SET vault_unlock_salt = $2,
		    wrapped_user_root_key = $3,
		    root_key_wrapping_version = $4,
		    encrypted_personal_vault_key = COALESCE($5, encrypted_personal_vault_key),
		    personal_vault_key_encryption_version = CASE WHEN $5::bytea IS NULL THEN personal_vault_key_encryption_version ELSE $4 END,
		    updated_at = $6
		WHERE user_id = $1`, userID, rewrap.VaultUnlockSalt, rewrap.WrappedUserRootKey, rewrap.EncryptionVersion, nullableBytes(rewrap.EncryptedPersonalVaultKey), repository.now())
	if err != nil {
		return fmt.Errorf("rewrap user crypto profile: %w", err)
	}
	if command.RowsAffected() != 1 {
		return errors.New("user crypto profile does not exist")
	}
	if err := transaction.Commit(ctx); err != nil {
		return fmt.Errorf("commit user crypto profile rewrap: %w", err)
	}
	return nil
}

func (repository *PostgresUserCryptoProfileRepository) MigrateUserCryptoProfile(ctx context.Context, userID string, migration identityapp.UserCryptoProfileMigration) (identityapp.UserCryptoProfileMigrationResult, error) {
	if userID == "" || migration.WrappedUserRootKey == nil && migration.EncryptedPersonalVaultKey == nil ||
		!validProfileWrapperMigration(migration.WrappedUserRootKey) || !validProfileWrapperMigration(migration.EncryptedPersonalVaultKey) {
		return identityapp.UserCryptoProfileMigrationConflict, nil
	}
	transaction, err := repository.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return "", fmt.Errorf("begin user crypto profile migration: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	if _, err := transaction.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, userID); err != nil {
		return "", fmt.Errorf("lock user crypto profile migration: %w", err)
	}
	var currentWrapped, currentPersonalKey []byte
	err = transaction.QueryRow(ctx, `
		SELECT wrapped_user_root_key, encrypted_personal_vault_key
		FROM user_crypto_profiles
		WHERE user_id = $1
		FOR UPDATE`, userID).Scan(&currentWrapped, &currentPersonalKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return identityapp.UserCryptoProfileMigrationConflict, nil
	}
	if err != nil {
		return "", fmt.Errorf("load encrypted profile wrappers for migration: %w", err)
	}
	defer clear(currentWrapped)
	defer clear(currentPersonalKey)

	wrappedState := profileWrapperMigrationState(currentWrapped, migration.WrappedUserRootKey)
	personalKeyState := profileWrapperMigrationState(currentPersonalKey, migration.EncryptedPersonalVaultKey)
	if wrappedState == profileMigrationConflict || personalKeyState == profileMigrationConflict {
		return identityapp.UserCryptoProfileMigrationConflict, nil
	}
	if wrappedState != profileMigrationReplace && personalKeyState != profileMigrationReplace {
		return identityapp.UserCryptoProfileMigrationAlreadyCommitted, nil
	}

	arguments := []any{userID}
	assignments := make([]string, 0, 3)
	conditions := []string{"user_id = $1"}
	if migration.WrappedUserRootKey != nil {
		if wrappedState == profileMigrationReplace {
			appendProfileMigrationAssignment(&arguments, &assignments, "wrapped_user_root_key", migration.WrappedUserRootKey.ReplacementCiphertext)
		}
		appendProfileMigrationPredicate(&arguments, &conditions, "wrapped_user_root_key", currentWrapped)
	}
	if migration.EncryptedPersonalVaultKey != nil {
		if personalKeyState == profileMigrationReplace {
			appendProfileMigrationAssignment(&arguments, &assignments, "encrypted_personal_vault_key", migration.EncryptedPersonalVaultKey.ReplacementCiphertext)
		}
		appendProfileMigrationPredicate(&arguments, &conditions, "encrypted_personal_vault_key", currentPersonalKey)
	}
	arguments = append(arguments, repository.now())
	assignments = append(assignments, fmt.Sprintf("updated_at = $%d", len(arguments)))
	query := fmt.Sprintf("UPDATE user_crypto_profiles SET %s WHERE %s", strings.Join(assignments, ", "), strings.Join(conditions, " AND "))
	command, err := transaction.Exec(ctx, query, arguments...)
	if err != nil {
		return "", fmt.Errorf("update encrypted user crypto profile wrappers: %w", err)
	}
	if command.RowsAffected() != 1 {
		return identityapp.UserCryptoProfileMigrationConflict, nil
	}
	if err := transaction.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit user crypto profile migration: %w", err)
	}
	return identityapp.UserCryptoProfileMigrationCommitted, nil
}

type profileMigrationState uint8

const (
	profileMigrationNone profileMigrationState = iota
	profileMigrationReplace
	profileMigrationAlreadyCommitted
	profileMigrationConflict
)

func validEncryptedProfileBlob(value []byte) bool {
	return len(value) >= 13 && len(value) <= 16*1024+29
}

func validProfileWrapperMigration(migration *identityapp.UserCryptoProfileWrapperMigration) bool {
	return migration == nil ||
		(len(migration.ExpectedCiphertext) >= 30 && len(migration.ExpectedCiphertext) <= 16*1024+29 &&
			len(migration.ReplacementCiphertext) >= 30 && len(migration.ReplacementCiphertext) <= 16*1024+29 &&
			migration.ExpectedCiphertext[0] == 1 && migration.ReplacementCiphertext[0] == 2)
}

func profileWrapperMigrationState(current []byte, migration *identityapp.UserCryptoProfileWrapperMigration) profileMigrationState {
	if migration == nil {
		return profileMigrationNone
	}
	if constantTimeBytesEqual(current, migration.ReplacementCiphertext) {
		return profileMigrationAlreadyCommitted
	}
	if constantTimeBytesEqual(current, migration.ExpectedCiphertext) {
		return profileMigrationReplace
	}
	return profileMigrationConflict
}

func constantTimeBytesEqual(left []byte, right []byte) bool {
	if len(left) != len(right) {
		return false
	}
	return subtle.ConstantTimeCompare(left, right) == 1
}

func appendProfileMigrationAssignment(arguments *[]any, assignments *[]string, column string, replacement []byte) {
	*arguments = append(*arguments, replacement)
	*assignments = append(*assignments, fmt.Sprintf("%s = $%d", column, len(*arguments)))
}

func appendProfileMigrationPredicate(arguments *[]any, conditions *[]string, column string, current []byte) {
	*arguments = append(*arguments, current)
	*conditions = append(*conditions, fmt.Sprintf("%s = $%d", column, len(*arguments)))
}

func nullableBytes(value []byte) any {
	if value == nil {
		return nil
	}
	return value
}

var _ identityapp.UserCryptoProfileRepository = (*PostgresUserCryptoProfileRepository)(nil)
var _ identityapp.UserEncryptionIdentityRepository = (*PostgresUserCryptoProfileRepository)(nil)
