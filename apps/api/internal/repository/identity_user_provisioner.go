package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/postgres"
	apiService "github.com/nooroctavian/rhasia-scret/apps/api/internal/service"
)

const passwordlessIssuerForProvisioning = "rhasia:passwordless"

type UserProvisioner struct {
	pool          *pgxpool.Pool
	now           func() time.Time
	allowNewUsers bool
}

func NewUserProvisioner(pool *pgxpool.Pool, now func() time.Time, allowNewUsers bool) (*UserProvisioner, error) {
	if pool == nil {
		return nil, errors.New("application-user repository is not configured")
	}
	if now == nil {
		now = time.Now
	}
	return &UserProvisioner{pool: pool, now: now, allowNewUsers: allowNewUsers}, nil
}

func (provisioner *UserProvisioner) Provision(ctx context.Context, principal apiService.Principal) (apiService.ApplicationUser, error) {
	if err := provisioner.assertCredentialWasIssuedAfterDeletion(ctx, principal); err != nil {
		return apiService.ApplicationUser{}, err
	}

	identity, err := provisioner.findIdentity(ctx, principal.Issuer, principal.Subject)
	if err == nil {
		return provisioner.resolveExistingIdentity(ctx, identity, principal)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return apiService.ApplicationUser{}, fmt.Errorf("load external identity: %w", err)
	}
	if !provisioner.canProvisionNewUser(principal) {
		return apiService.ApplicationUser{}, errors.New("application admission denied")
	}

	created, err := provisioner.createIdentity(ctx, principal)
	if err == nil {
		return created, nil
	}
	if !isUniqueViolation(err) {
		return apiService.ApplicationUser{}, fmt.Errorf("create application user: %w", err)
	}
	raced, lookupErr := provisioner.findIdentity(ctx, principal.Issuer, principal.Subject)
	if lookupErr != nil {
		return apiService.ApplicationUser{}, fmt.Errorf("resolve raced external identity: %w", lookupErr)
	}
	return provisioner.resolveExistingIdentity(ctx, raced, principal)
}

func (provisioner *UserProvisioner) canProvisionNewUser(principal apiService.Principal) bool {
	return provisioner.allowNewUsers && principal.EmailVerified
}

func (provisioner *UserProvisioner) assertCredentialWasIssuedAfterDeletion(ctx context.Context, principal apiService.Principal) error {
	var deletedAt time.Time
	err := provisioner.pool.QueryRow(ctx, `
		SELECT deleted_at
		FROM account_deletion_identities
		WHERE issuer = $1 AND subject = $2
		ORDER BY deleted_at DESC
		LIMIT 1`, principal.Issuer, principal.Subject).Scan(&deletedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("check account deletion identity: %w", err)
	}
	if principal.IssuedAt.IsZero() || !principal.IssuedAt.After(deletedAt) {
		return apiService.ErrCredentialInvalidated
	}
	return nil
}

type externalIdentityRecord struct {
	userID             string
	userEmail          string
	userStatus         string
	issuer             string
	subject            string
	identityEmail      *string
	identityEmailValid bool
}

func (provisioner *UserProvisioner) findIdentity(ctx context.Context, issuer string, subject string) (externalIdentityRecord, error) {
	var identity externalIdentityRecord
	err := provisioner.pool.QueryRow(ctx, `
		SELECT u.id, u.email, u.status, e.issuer, e.subject, e.email, e.email_verified_at IS NOT NULL
		FROM external_identities AS e
		JOIN application_users AS u ON u.id = e.application_user_id
		WHERE e.issuer = $1 AND e.subject = $2`, issuer, subject).Scan(
		&identity.userID,
		&identity.userEmail,
		&identity.userStatus,
		&identity.issuer,
		&identity.subject,
		&identity.identityEmail,
		&identity.identityEmailValid,
	)
	return identity, err
}

func (provisioner *UserProvisioner) resolveExistingIdentity(ctx context.Context, identity externalIdentityRecord, principal apiService.Principal) (apiService.ApplicationUser, error) {
	if identity.identityEmail != nil && *identity.identityEmail == principal.Email && (identity.identityEmailValid || !principal.EmailVerified) {
		return apiService.ApplicationUser{ID: identity.userID, Email: identity.userEmail, Status: identity.userStatus}, nil
	}

	now := provisioner.now()
	transaction, err := provisioner.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return apiService.ApplicationUser{}, fmt.Errorf("begin application identity update: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()

	var verifiedAt *time.Time
	if principal.EmailVerified {
		verifiedAt = &now
	}
	command, err := transaction.Exec(ctx, `
		UPDATE external_identities
		SET email = $3, email_verified_at = $4, updated_at = $5
		WHERE issuer = $1 AND subject = $2`, principal.Issuer, principal.Subject, principal.Email, verifiedAt, now)
	if err != nil {
		return apiService.ApplicationUser{}, fmt.Errorf("update external identity: %w", err)
	}
	if command.RowsAffected() != 1 {
		return apiService.ApplicationUser{}, apiService.ErrCredentialInvalidated
	}
	var user apiService.ApplicationUser
	err = transaction.QueryRow(ctx, `
		UPDATE application_users
		SET email = $2, updated_at = $3
		WHERE id = $1
		RETURNING id, email, status`, identity.userID, principal.Email, now).Scan(&user.ID, &user.Email, &user.Status)
	if err != nil {
		return apiService.ApplicationUser{}, fmt.Errorf("update application user email: %w", err)
	}
	if err := transaction.Commit(ctx); err != nil {
		return apiService.ApplicationUser{}, fmt.Errorf("commit application identity update: %w", err)
	}
	return user, nil
}

func (provisioner *UserProvisioner) createIdentity(ctx context.Context, principal apiService.Principal) (apiService.ApplicationUser, error) {
	now := provisioner.now()
	transaction, err := provisioner.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return apiService.ApplicationUser{}, err
	}
	defer func() { _ = transaction.Rollback(ctx) }()

	userID, err := postgres.NewCUID()
	if err != nil {
		return apiService.ApplicationUser{}, err
	}
	externalIdentityID, err := postgres.NewCUID()
	if err != nil {
		return apiService.ApplicationUser{}, err
	}
	var emailVerifiedAt *time.Time
	if principal.EmailVerified {
		emailVerifiedAt = &now
	}
	var user apiService.ApplicationUser
	err = transaction.QueryRow(ctx, `
		INSERT INTO application_users (id, email, status, created_at, updated_at)
		VALUES ($1, $2, 'ACTIVE', $3, $3)
		RETURNING id, email, status`, userID, principal.Email, now).Scan(&user.ID, &user.Email, &user.Status)
	if err != nil {
		return apiService.ApplicationUser{}, err
	}
	_, err = transaction.Exec(ctx, `
		INSERT INTO external_identities (id, application_user_id, issuer, subject, email, email_verified_at, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`, externalIdentityID, userID, principal.Issuer, principal.Subject, principal.Email, emailVerifiedAt, now)
	if err != nil {
		return apiService.ApplicationUser{}, err
	}
	if err := transaction.Commit(ctx); err != nil {
		return apiService.ApplicationUser{}, err
	}
	return user, nil
}

func isUniqueViolation(err error) bool {
	var postgresError *pgconn.PgError
	return errors.As(err, &postgresError) && postgresError.Code == "23505"
}

var _ apiService.UserProvisioner = (*UserProvisioner)(nil)
