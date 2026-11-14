package infrastructure

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/postgres"
	identityapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/service/identity"
)

const (
	passkeyRecoveryChallengeTTL         = 5 * time.Minute
	maxPasskeyRecoveryCredentialIDBytes = 1023
)

var allowedPasskeyRecoveryTransports = [...]string{"ble", "hybrid", "internal", "nfc", "smart-card", "usb"}

type PostgresPasskeyRecoveryRepository struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

func NewPostgresPasskeyRecoveryRepository(pool *pgxpool.Pool, now func() time.Time) (*PostgresPasskeyRecoveryRepository, error) {
	if pool == nil {
		return nil, errors.New("passkey recovery repository is not configured")
	}
	if now == nil {
		now = time.Now
	}
	return &PostgresPasskeyRecoveryRepository{pool: pool, now: now}, nil
}

func (repository *PostgresPasskeyRecoveryRepository) IssueChallenge(ctx context.Context, userID string, purpose identityapp.PasskeyRecoveryPurpose, challenge string) error {
	if userID == "" || !identityapp.ValidPasskeyRecoveryPurpose(purpose) || !validPasskeyRecoveryChallenge(challenge) {
		return errors.New("passkey recovery challenge is invalid")
	}
	id, err := postgres.NewCUID()
	if err != nil {
		return fmt.Errorf("generate passkey recovery challenge ID: %w", err)
	}
	transaction, err := repository.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin passkey recovery challenge issuance: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	lockKey := userID + ":" + string(purpose)
	if _, err := transaction.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, lockKey); err != nil {
		return fmt.Errorf("lock passkey recovery challenge issuance: %w", err)
	}
	if _, err := transaction.Exec(ctx, `DELETE FROM passkey_recovery_challenges WHERE user_id = $1 AND purpose = $2`, userID, string(purpose)); err != nil {
		return fmt.Errorf("replace passkey recovery challenge: %w", err)
	}
	if _, err := transaction.Exec(ctx, `
		INSERT INTO passkey_recovery_challenges (id, user_id, purpose, challenge, expires_at)
		VALUES ($1, $2, $3, $4, $5)`, id, userID, string(purpose), challenge, repository.now().Add(passkeyRecoveryChallengeTTL)); err != nil {
		return fmt.Errorf("store passkey recovery challenge: %w", err)
	}
	if err := transaction.Commit(ctx); err != nil {
		return fmt.Errorf("commit passkey recovery challenge issuance: %w", err)
	}
	return nil
}

func (repository *PostgresPasskeyRecoveryRepository) ConsumeChallenge(ctx context.Context, userID string, purpose identityapp.PasskeyRecoveryPurpose) (string, error) {
	if userID == "" || !identityapp.ValidPasskeyRecoveryPurpose(purpose) {
		return "", errors.New("passkey recovery challenge lookup is invalid")
	}
	transaction, err := repository.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return "", fmt.Errorf("begin passkey recovery challenge consumption: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	lockKey := userID + ":" + string(purpose)
	if _, err := transaction.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, lockKey); err != nil {
		return "", fmt.Errorf("lock passkey recovery challenge consumption: %w", err)
	}
	var challenge string
	err = transaction.QueryRow(ctx, `
		SELECT challenge
		FROM passkey_recovery_challenges
		WHERE user_id = $1 AND purpose = $2 AND expires_at > $3
		ORDER BY created_at DESC
		LIMIT 1`, userID, string(purpose), repository.now()).Scan(&challenge)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", fmt.Errorf("load passkey recovery challenge: %w", err)
	}
	if _, err := transaction.Exec(ctx, `DELETE FROM passkey_recovery_challenges WHERE user_id = $1 AND purpose = $2`, userID, string(purpose)); err != nil {
		return "", fmt.Errorf("delete consumed passkey recovery challenges: %w", err)
	}
	if err := transaction.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit passkey recovery challenge consumption: %w", err)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return challenge, nil
}

func (repository *PostgresPasskeyRecoveryRepository) GetCredential(ctx context.Context, userID string) (*identityapp.PasskeyRecoveryCredential, error) {
	if userID == "" {
		return nil, errors.New("passkey recovery credential lookup is invalid")
	}
	var credential identityapp.PasskeyRecoveryCredential
	var transportsJSON []byte
	err := repository.pool.QueryRow(ctx, `
		SELECT credential_id, public_key, counter, COALESCE(transports, '[]'::jsonb), encrypted_recovery_package
		FROM passkey_recovery_credentials
		WHERE user_id = $1`, userID).Scan(
		&credential.CredentialID,
		&credential.PublicKey,
		&credential.Counter,
		&transportsJSON,
		&credential.EncryptedRecoveryPackage,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		credential.Clear()
		clear(transportsJSON)
		return nil, fmt.Errorf("load passkey recovery credential: %w", err)
	}
	defer clear(transportsJSON)
	if err := json.Unmarshal(transportsJSON, &credential.Transports); err != nil || !validPersistedPasskeyRecoveryCredential(credential) {
		credential.Clear()
		return nil, errors.New("stored passkey recovery credential is invalid")
	}
	return &credential, nil
}

func (repository *PostgresPasskeyRecoveryRepository) SaveCredential(ctx context.Context, userID string, registration identityapp.PasskeyRecoveryRegistration) error {
	if userID == "" || !validPasskeyRecoveryRegistration(registration) {
		return errors.New("passkey recovery credential is invalid")
	}
	var transports any
	if registration.Transports != nil {
		transportsJSON, err := json.Marshal(registration.Transports)
		if err != nil {
			return errors.New("passkey recovery credential is invalid")
		}
		defer clear(transportsJSON)
		transports = string(transportsJSON)
	}
	transaction, err := repository.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin passkey recovery credential save: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	if _, err := transaction.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, userID); err != nil {
		return fmt.Errorf("lock passkey recovery credential save: %w", err)
	}
	var cryptoProfileExists bool
	if err := transaction.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM user_crypto_profiles WHERE user_id = $1)`, userID).Scan(&cryptoProfileExists); err != nil {
		return fmt.Errorf("check user crypto profile for passkey recovery: %w", err)
	}
	if !cryptoProfileExists {
		return errors.New("user crypto profile does not exist")
	}
	_, err = transaction.Exec(ctx, `
		INSERT INTO passkey_recovery_credentials
			(user_id, credential_id, public_key, counter, transports, encrypted_recovery_package, updated_at)
		VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
		ON CONFLICT (user_id) DO UPDATE SET
			credential_id = EXCLUDED.credential_id,
			public_key = EXCLUDED.public_key,
			counter = EXCLUDED.counter,
			transports = COALESCE($5::jsonb, passkey_recovery_credentials.transports),
			encrypted_recovery_package = EXCLUDED.encrypted_recovery_package,
			updated_at = EXCLUDED.updated_at`,
		userID, registration.CredentialID, registration.PublicKey, registration.Counter, transports,
		registration.EncryptedRecoveryPackage, repository.now())
	if err != nil {
		return fmt.Errorf("save passkey recovery credential: %w", err)
	}
	if err := transaction.Commit(ctx); err != nil {
		return fmt.Errorf("commit passkey recovery credential save: %w", err)
	}
	return nil
}

func (repository *PostgresPasskeyRecoveryRepository) UpdateCounter(ctx context.Context, userID string, credentialID []byte, expectedCounter int64, counter int64) (bool, error) {
	if userID == "" || len(credentialID) < 1 || len(credentialID) > maxPasskeyRecoveryCredentialIDBytes || expectedCounter < 0 || counter < 0 {
		return false, errors.New("passkey recovery counter update is invalid")
	}
	command, err := repository.pool.Exec(ctx, `
		UPDATE passkey_recovery_credentials
		SET counter = $4, updated_at = $5
		WHERE user_id = $1 AND credential_id = $2 AND counter = $3`,
		userID, credentialID, expectedCounter, counter, repository.now())
	if err != nil {
		return false, fmt.Errorf("update passkey recovery authenticator counter: %w", err)
	}
	return command.RowsAffected() == 1, nil
}

func (repository *PostgresPasskeyRecoveryRepository) RemoveCredential(ctx context.Context, userID string) error {
	if userID == "" {
		return errors.New("passkey recovery credential removal is invalid")
	}
	transaction, err := repository.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin passkey recovery credential removal: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	if _, err := transaction.Exec(ctx, `DELETE FROM passkey_recovery_challenges WHERE user_id = $1`, userID); err != nil {
		return fmt.Errorf("delete passkey recovery challenges: %w", err)
	}
	if _, err := transaction.Exec(ctx, `DELETE FROM passkey_recovery_credentials WHERE user_id = $1`, userID); err != nil {
		return fmt.Errorf("delete passkey recovery credential: %w", err)
	}
	if err := transaction.Commit(ctx); err != nil {
		return fmt.Errorf("commit passkey recovery credential removal: %w", err)
	}
	return nil
}

func validPasskeyRecoveryChallenge(challenge string) bool {
	decoded, err := base64.RawURLEncoding.Strict().DecodeString(challenge)
	defer clear(decoded)
	return err == nil && len(decoded) >= 16 && base64.RawURLEncoding.EncodeToString(decoded) == challenge
}

func validPasskeyRecoveryRegistration(registration identityapp.PasskeyRecoveryRegistration) bool {
	return len(registration.CredentialID) >= 1 && len(registration.CredentialID) <= maxPasskeyRecoveryCredentialIDBytes &&
		len(registration.PublicKey) > 0 && len(registration.PublicKey) <= 4096 && registration.Counter >= 0 &&
		len(registration.EncryptedRecoveryPackage) >= 13 && len(registration.EncryptedRecoveryPackage) <= 16*1024+29 &&
		validPasskeyRecoveryTransports(registration.Transports)
}

func validPersistedPasskeyRecoveryCredential(credential identityapp.PasskeyRecoveryCredential) bool {
	return len(credential.CredentialID) >= 1 && len(credential.CredentialID) <= maxPasskeyRecoveryCredentialIDBytes &&
		len(credential.PublicKey) > 0 && len(credential.PublicKey) <= 4096 && credential.Counter >= 0 &&
		len(credential.EncryptedRecoveryPackage) >= 13 && len(credential.EncryptedRecoveryPackage) <= 16*1024+29 &&
		validPasskeyRecoveryTransports(credential.Transports)
}

func validPasskeyRecoveryTransports(transports []string) bool {
	if len(transports) > len(allowedPasskeyRecoveryTransports) {
		return false
	}
	for index, transport := range transports {
		if !slices.Contains(allowedPasskeyRecoveryTransports[:], transport) || slices.Contains(transports[:index], transport) {
			return false
		}
	}
	return true
}

var _ identityapp.PasskeyRecoveryRepository = (*PostgresPasskeyRecoveryRepository)(nil)
