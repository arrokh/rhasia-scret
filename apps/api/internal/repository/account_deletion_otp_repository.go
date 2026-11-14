package repository

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/postgres"
	apiService "github.com/nooroctavian/rhasia-scret/apps/api/internal/service"
)

const (
	accountDeletionOTPContext           = "rhasia:account-deletion:otp:"
	accountDeletionAuthorizationContext = "rhasia:account-deletion:authorization:"
	accountDeletionPasswordlessPurpose  = "PASSWORDLESS_OTP"
)

type PasswordlessOTPRepository struct {
	pool   *pgxpool.Pool
	secret []byte
}

func NewPasswordlessOTPRepository(pool *pgxpool.Pool, sessionSecret []byte) (*PasswordlessOTPRepository, error) {
	if pool == nil || len(sessionSecret) < 32 {
		return nil, errors.New("account deletion OTP repository is not configured")
	}
	return &PasswordlessOTPRepository{pool: pool, secret: append([]byte(nil), sessionSecret...)}, nil
}

func (repository *PasswordlessOTPRepository) Close() {
	clear(repository.secret)
	repository.secret = nil
}

func (repository *PasswordlessOTPRepository) CreatePasswordlessOTPChallenge(ctx context.Context, applicationUserID string, now time.Time) (apiService.PasswordlessOTPChallenge, error) {
	if applicationUserID == "" {
		return apiService.PasswordlessOTPChallenge{}, errors.New("account deletion OTP user is invalid")
	}
	otp, err := generateAccountDeletionOTP()
	if err != nil {
		return apiService.PasswordlessOTPChallenge{}, fmt.Errorf("generate account deletion OTP: %w", err)
	}
	authorizationSeed, err := randomAccountDeletionTokenBytes()
	if err != nil {
		return apiService.PasswordlessOTPChallenge{}, fmt.Errorf("generate account deletion authorization seed: %w", err)
	}
	defer clear(authorizationSeed)
	challengeID, err := postgres.NewCUID()
	if err != nil {
		return apiService.PasswordlessOTPChallenge{}, fmt.Errorf("generate account deletion challenge ID: %w", err)
	}
	otpDigest := repository.digest(accountDeletionOTPContext, otp)
	defer clear(otpDigest)
	authorizationSeedToken := base64.RawURLEncoding.EncodeToString(authorizationSeed)
	authorizationDigest := repository.digest(accountDeletionAuthorizationContext, authorizationSeedToken)
	defer clear(authorizationDigest)

	transaction, err := repository.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return apiService.PasswordlessOTPChallenge{}, fmt.Errorf("begin account deletion OTP challenge: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	if _, err := transaction.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, applicationUserID); err != nil {
		return apiService.PasswordlessOTPChallenge{}, fmt.Errorf("lock account deletion OTP issuance: %w", err)
	}
	if _, err := transaction.Exec(ctx, `
		DELETE FROM account_deletion_challenges
		WHERE application_user_id = $1 AND purpose = $2 AND verified_at IS NULL AND consumed_at IS NULL`,
		applicationUserID, accountDeletionPasswordlessPurpose); err != nil {
		return apiService.PasswordlessOTPChallenge{}, fmt.Errorf("replace account deletion OTP challenge: %w", err)
	}
	_, err = transaction.Exec(ctx, `
		INSERT INTO account_deletion_challenges
			(id, application_user_id, purpose, otp_digest, authorization_digest, attempt_count, expires_at)
		VALUES ($1, $2, $3, $4, $5, 0, $6)`,
		challengeID, applicationUserID, accountDeletionPasswordlessPurpose, otpDigest, authorizationDigest, now.Add(apiService.PasswordlessOTPLifetime))
	if err != nil {
		return apiService.PasswordlessOTPChallenge{}, fmt.Errorf("insert account deletion OTP challenge: %w", err)
	}
	if err := transaction.Commit(ctx); err != nil {
		return apiService.PasswordlessOTPChallenge{}, fmt.Errorf("commit account deletion OTP challenge: %w", err)
	}
	return apiService.PasswordlessOTPChallenge{ID: challengeID, OTP: otp}, nil
}

func (repository *PasswordlessOTPRepository) VerifyPasswordlessOTP(ctx context.Context, applicationUserID string, otp string, now time.Time) (string, error) {
	if applicationUserID == "" || !apiService.ValidPasswordlessOTP(otp) {
		return "", apiService.ErrPasswordlessOTPInvalid
	}
	transaction, err := repository.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return "", fmt.Errorf("begin account deletion OTP verification: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	var challengeID string
	var storedDigest []byte
	var attemptCount int
	err = transaction.QueryRow(ctx, `
		SELECT id, otp_digest, attempt_count
		FROM account_deletion_challenges
		WHERE application_user_id = $1 AND purpose = $2 AND consumed_at IS NULL AND expires_at > $3
		ORDER BY created_at DESC
		LIMIT 1
		FOR UPDATE`, applicationUserID, accountDeletionPasswordlessPurpose, now).Scan(&challengeID, &storedDigest, &attemptCount)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", apiService.ErrPasswordlessOTPExpired
	}
	if err != nil {
		return "", fmt.Errorf("load account deletion OTP challenge: %w", err)
	}
	defer clear(storedDigest)
	if attemptCount >= apiService.PasswordlessOTPAttemptLimit {
		return "", apiService.ErrPasswordlessOTPLocked
	}
	candidateDigest := repository.digest(accountDeletionOTPContext, otp)
	defer clear(candidateDigest)
	if len(storedDigest) != len(candidateDigest) || subtle.ConstantTimeCompare(storedDigest, candidateDigest) != 1 {
		command, updateErr := transaction.Exec(ctx, `
			UPDATE account_deletion_challenges
			SET attempt_count = attempt_count + 1
			WHERE id = $1 AND consumed_at IS NULL AND attempt_count < $2`, challengeID, apiService.PasswordlessOTPAttemptLimit)
		if updateErr != nil {
			return "", fmt.Errorf("record account deletion OTP attempt: %w", updateErr)
		}
		if command.RowsAffected() != 1 {
			return "", apiService.ErrPasswordlessOTPLocked
		}
		if err := transaction.Commit(ctx); err != nil {
			return "", fmt.Errorf("commit invalid account deletion OTP attempt: %w", err)
		}
		return "", apiService.ErrPasswordlessOTPInvalid
	}
	authorizationTokenBytes, err := randomAccountDeletionTokenBytes()
	if err != nil {
		return "", fmt.Errorf("generate account deletion authorization: %w", err)
	}
	defer clear(authorizationTokenBytes)
	authorizationToken := base64.RawURLEncoding.EncodeToString(authorizationTokenBytes)
	authorizationDigest := repository.digest(accountDeletionAuthorizationContext, authorizationToken)
	defer clear(authorizationDigest)
	command, err := transaction.Exec(ctx, `
		UPDATE account_deletion_challenges
		SET consumed_at = $2, verified_at = $2, authorization_digest = $3
		WHERE id = $1 AND consumed_at IS NULL AND expires_at > $2 AND attempt_count < $4`,
		challengeID, now, authorizationDigest, apiService.PasswordlessOTPAttemptLimit)
	if err != nil {
		return "", fmt.Errorf("consume account deletion OTP challenge: %w", err)
	}
	if command.RowsAffected() != 1 {
		return "", apiService.ErrPasswordlessOTPExpired
	}
	if err := transaction.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit account deletion OTP verification: %w", err)
	}
	return authorizationToken, nil
}

func (repository *PasswordlessOTPRepository) digest(context string, value string) []byte {
	return repository.digestBytes(context, []byte(value))
}

func (repository *PasswordlessOTPRepository) digestBytes(context string, value []byte) []byte {
	mac := hmac.New(sha256.New, repository.secret)
	_, _ = mac.Write([]byte(context))
	_, _ = mac.Write(value)
	return mac.Sum(nil)
}

func generateAccountDeletionOTP() (string, error) {
	value, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", value.Int64()), nil
}

func randomAccountDeletionTokenBytes() ([]byte, error) {
	value := make([]byte, 32)
	if _, err := rand.Read(value); err != nil {
		clear(value)
		return nil, err
	}
	return value, nil
}

var _ apiService.PasswordlessOTPRepository = (*PasswordlessOTPRepository)(nil)
