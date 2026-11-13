package servercomposition

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v5"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/config"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	accountdeletioninfra "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/account-deletion/infrastructure"
	accountdeletionhttp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/account-deletion/presentation/http"
	auditinfra "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/audit/infrastructure"
	audithttp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/audit/presentation/http"
	accountinfra "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/authenticator-account/infrastructure"
	accounthttp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/authenticator-account/presentation/http"
	identity "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/identity"
	identityapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/identity/application"
	identityinfra "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/identity/infrastructure"
	identityhttp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/identity/presentation/http"
	rateinfra "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/rate-limiting/infrastructure"
	retentionapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/retention/application"
	retentioninfra "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/retention/infrastructure"
	retentionhttp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/retention/presentation/http"
	syncinfra "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/sync/infrastructure"
	synchtml "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/sync/presentation/http"
	vaultarchiveinfra "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/vault-archive/infrastructure"
	vaultarchivehttp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/vault-archive/presentation/http"
	vaultmanagementapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/vault-management/application"
	vaultmanagementinfra "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/vault-management/infrastructure"
	vaultmanagementhttp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/vault-management/presentation/http"
	vaultmembershipinfra "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/vault-membership/infrastructure"
	vaultmembershiphttp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/vault-membership/presentation/http"
)

func readAuthConfiguration(environment config.Environment) (identityinfra.AuthConfiguration, error) {
	authEnvironment := identityinfra.AuthEnvironment{
		AuthBackend:            environment.AuthBackend,
		NodeEnvironment:        environment.NodeEnvironment,
		DeploymentTarget:       environment.DeploymentTarget,
		WebOrigin:              environment.WebOrigin,
		AuthAppOrigin:          environment.AuthAppOrigin,
		MagicLinkSecret:        environment.AuthMagicLinkSecret,
		SessionSecret:          environment.AuthSessionSecret,
		TurnstileSecretKey:     environment.TurnstileSecretKey,
		MagicLinkTTLSeconds:    environment.AuthMagicLinkTTL,
		AccessTokenTTLSeconds:  environment.AuthAccessTokenTTL,
		RefreshTokenTTLSeconds: environment.AuthRefreshTokenTTL,
	}
	authConfiguration, err := identityinfra.ReadAuthConfiguration(authEnvironment)
	if err != nil {
		return identityinfra.AuthConfiguration{}, fmt.Errorf("read API authentication configuration: %w", err)
	}
	return authConfiguration, nil
}

func newApplicationSessionVerifier(
	environment config.Environment,
	authentication identityinfra.AuthConfiguration,
	pool *pgxpool.Pool,
	clock func() time.Time,
) (identityapp.SessionVerifier, error) {
	e2eVerifier := identityinfra.NewE2ESessionVerifier(
		environment.NodeEnvironment,
		environment.E2EBrowserTests,
		environment.E2EBrowserTestUsers,
	)
	if e2eVerifier != nil {
		return e2eVerifier, nil
	}
	if authentication.Backend != identityinfra.AuthBackendPasswordless {
		return disabledSessionVerifier{}, nil
	}
	if authentication.Passwordless == nil {
		return nil, errors.New("passwordless session configuration is unavailable")
	}
	verifier, err := identityinfra.NewPostgresSessionVerifier(pool, authentication.Passwordless.SessionSecret, clock)
	if err != nil {
		return nil, err
	}
	return verifier, nil
}

// NewRouter composes the database-backed Go API from context-owned adapters.
// The caller owns pool creation, liveness checks, and shutdown.
func NewRouter(
	pool *pgxpool.Pool,
	environment config.Environment,
	logger httpapi.APIEventLogger,
	clock func() time.Time,
) (*echo.Echo, error) {
	if pool == nil {
		return nil, errors.New("API PostgreSQL pool is not configured")
	}
	if clock == nil {
		clock = time.Now
	}
	if logger == nil {
		logger = httpapi.NewJSONEventLogger()
	}

	authConfiguration, err := readAuthConfiguration(environment)
	if err != nil {
		return nil, err
	}

	emailDelivery, passwordlessEmailSender, err := createEmailDelivery(environment, authConfiguration)
	if err != nil {
		return nil, err
	}
	turnstileConfiguration := identityinfra.TurnstileConfiguration{}
	if authConfiguration.Backend == identityinfra.AuthBackendPasswordless {
		turnstileConfiguration = authConfiguration.Turnstile
	} else if authConfiguration.Backend != identityinfra.AuthBackendNone {
		return nil, errors.New("API authentication backend is unsupported")
	}
	turnstile, err := identityinfra.NewTurnstileValidator(turnstileConfiguration, nil)
	if err != nil {
		return nil, fmt.Errorf("create Turnstile validator: %w", err)
	}

	applicationRateLimiter, err := rateinfra.NewPostgresApplicationRateLimiter(pool)
	if err != nil {
		return nil, fmt.Errorf("create application rate limiter: %w", err)
	}
	allowNewUsers := authConfiguration.Backend == identityinfra.AuthBackendPasswordless
	userProvisioner, err := identityinfra.NewPostgresUserProvisioner(pool, clock, allowNewUsers)
	if err != nil {
		return nil, fmt.Errorf("create Application User provisioner: %w", err)
	}
	sessionVerifier, err := newApplicationSessionVerifier(environment, authConfiguration, pool, clock)
	if err != nil {
		return nil, fmt.Errorf("create passwordless session verifier: %w", err)
	}

	userCryptoProfiles, err := identityinfra.NewPostgresUserCryptoProfileRepository(pool, clock)
	if err != nil {
		return nil, fmt.Errorf("create User Crypto Profile repository: %w", err)
	}
	userCryptoProfileService := identityapp.NewUserCryptoProfileService(userCryptoProfiles)
	userEncryptionIdentityService := identityapp.NewUserEncryptionIdentityService(userCryptoProfiles)
	userEncryptionIdentityRotationRepository, err := identityinfra.NewPostgresUserEncryptionIdentityRotationRepository(pool, clock)
	if err != nil {
		return nil, fmt.Errorf("create User Encryption identity rotation repository: %w", err)
	}
	userEncryptionIdentityRotationService := identityapp.NewUserEncryptionIdentityRotationService(userEncryptionIdentityRotationRepository)
	passkeyRecovery, err := identityinfra.NewPostgresPasskeyRecoveryRepository(pool, clock)
	if err != nil {
		return nil, fmt.Errorf("create Passkey Recovery repository: %w", err)
	}
	passkeyRecoveryWebAuthn := createPasskeyRecoveryWebAuthn(environment)
	if passkeyRecoveryWebAuthn == nil && (environment.PasskeyRPID != "" || environment.PasskeyOrigin != "") {
		logger.Log("warn", "passkey_recovery_configuration_invalid", map[string]any{"requestId": "startup"})
	}

	var passwordlessService identityhttp.PasswordlessService
	var anonymousRateLimiter identityhttp.AnonymousAuthRateLimiter
	if authConfiguration.Backend == identityinfra.AuthBackendPasswordless {
		passwordlessRepository, repositoryErr := identityinfra.NewPostgresPasswordlessAuthRepository(pool, *authConfiguration.Passwordless)
		if repositoryErr != nil {
			return nil, fmt.Errorf("create passwordless authentication repository: %w", repositoryErr)
		}
		passwordlessService, err = identityapp.NewPasswordlessAuthService(passwordlessRepository, passwordlessEmailSender, *authConfiguration.Passwordless, clock)
		if err != nil {
			return nil, fmt.Errorf("create passwordless authentication service: %w", err)
		}
		anonymousRateLimiter, err = identityinfra.NewPostgresAnonymousAuthRateLimiter(pool, authConfiguration.Passwordless.MagicLinkSecret)
		if err != nil {
			return nil, fmt.Errorf("create anonymous authentication rate limiter: %w", err)
		}
	}

	authenticator := identityapp.Authenticator{
		Sessions:    sessionVerifier,
		Users:       userProvisioner,
		RateLimiter: applicationRateLimiter,
	}
	identityHandlers := identityhttp.NewHandlers(identityhttp.Dependencies{
		WebOrigin:                  environment.WebOrigin,
		Backend:                    authConfiguration.Backend,
		Passwordless:               passwordlessService,
		Configuration:              authConfiguration.Passwordless,
		SessionVerifier:            sessionVerifier,
		Authenticator:              authenticator,
		CryptoProfiles:             userCryptoProfileService,
		EncryptionIdentity:         userEncryptionIdentityService,
		EncryptionIdentityRotation: userEncryptionIdentityRotationService,
		PasskeyRecovery:            passkeyRecovery,
		PasskeyRecoveryWebAuthn:    passkeyRecoveryWebAuthn,
		AnonymousRateLimiter:       anonymousRateLimiter,
		Turnstile:                  turnstile,
		Logger:                     logger,
		NodeEnvironment:            environment.NodeEnvironment,
		E2EBrowserTests:            environment.E2EBrowserTests,
		Now:                        clock,
	})

	personalAccountRepository, err := accountinfra.NewPostgresPersonalAccountRepository(pool, clock)
	if err != nil {
		return nil, fmt.Errorf("create Personal Account repository: %w", err)
	}
	sharedAccountRepository, err := accountinfra.NewPostgresSharedAccountRepository(pool, clock)
	if err != nil {
		return nil, fmt.Errorf("create Shared Account repository: %w", err)
	}

	personalVaultRepository, err := vaultmanagementinfra.NewPostgresPersonalVaultRepository(pool, clock)
	if err != nil {
		return nil, fmt.Errorf("create Personal Vault repository: %w", err)
	}
	sharedVaultRepository, err := vaultmanagementinfra.NewPostgresSharedVaultRepository(pool, clock)
	if err != nil {
		return nil, fmt.Errorf("create Shared Vault repository: %w", err)
	}
	personalVaultInitializer, err := vaultmanagementinfra.NewPostgresPersonalVaultInitializer(pool, clock)
	if err != nil {
		return nil, fmt.Errorf("create Personal Vault initializer: %w", err)
	}
	personalVaultInitializationService := vaultmanagementapp.NewPersonalVaultInitializationService(personalVaultInitializer)
	destructivePersonalVaultResetRepository, err := vaultmanagementinfra.NewPostgresDestructivePersonalVaultResetRepository(pool, clock)
	if err != nil {
		return nil, fmt.Errorf("create destructive Personal Vault reset repository: %w", err)
	}
	sharedVaultRecoveryRepository, err := vaultmanagementinfra.NewPostgresSharedVaultRecoveryRepository(pool, clock)
	if err != nil {
		return nil, fmt.Errorf("create Shared Vault recovery repository: %w", err)
	}
	vaultKeyRotationRepository, err := vaultmanagementinfra.NewPostgresVaultKeyRotationRepository(pool, clock)
	if err != nil {
		return nil, fmt.Errorf("create Vault key rotation repository: %w", err)
	}

	sharedVaultAccessRepository, err := vaultmembershipinfra.NewPostgresSharedVaultAccessRepository(pool)
	if err != nil {
		return nil, fmt.Errorf("create Shared Vault access repository: %w", err)
	}
	membershipLifecycleRepository, err := vaultmembershipinfra.NewPostgresMembershipLifecycleRepository(pool, clock)
	if err != nil {
		return nil, fmt.Errorf("create membership lifecycle repository: %w", err)
	}
	secureShareLinkRepository, err := vaultmembershipinfra.NewPostgresSecureShareLinkRepository(pool, clock)
	if err != nil {
		return nil, fmt.Errorf("create Secure Share Link repository: %w", err)
	}
	sharedVaultPermissionRepository, err := vaultmembershipinfra.NewPostgresSharedVaultAccountPermissionRepository(pool, clock)
	if err != nil {
		return nil, fmt.Errorf("create Shared Vault permission repository: %w", err)
	}
	applicationUserEmailReader, err := identityinfra.NewPostgresApplicationUserEmailReader(pool)
	if err != nil {
		return nil, fmt.Errorf("create Application User email reader: %w", err)
	}
	vaultParticipantRepository, err := vaultmembershipinfra.NewPostgresVaultParticipantRepository(pool, applicationUserEmailReader, clock)
	if err != nil {
		return nil, fmt.Errorf("create Vault participant repository: %w", err)
	}

	vaultAuditRepository, err := auditinfra.NewPostgresVaultAuditRepository(pool, clock)
	if err != nil {
		return nil, fmt.Errorf("create Vault audit repository: %w", err)
	}
	workspaceBundleReader, err := syncinfra.NewPostgresWorkspaceBundleReader(pool, clock)
	if err != nil {
		return nil, fmt.Errorf("create workspace bundle reader: %w", err)
	}
	encryptedVaultImportRepository, err := vaultarchiveinfra.NewPostgresEncryptedVaultImportRepository(pool, clock)
	if err != nil {
		return nil, fmt.Errorf("create encrypted Vault import repository: %w", err)
	}
	retentionRepository, err := retentioninfra.NewPostgresRetentionPurgeRepository(pool)
	if err != nil {
		return nil, fmt.Errorf("create retention repository: %w", err)
	}
	retentionService := retentionapp.NewService(retentionRepository)

	deletionSessionSecret, deletionAnonymousSecret, err := accountDeletionSecrets(authConfiguration)
	if err != nil {
		return nil, err
	}
	previewRepository, err := accountdeletioninfra.NewPostgresPreviewRepository(pool)
	if err != nil {
		return nil, fmt.Errorf("create account deletion preview repository: %w", err)
	}
	deletionRepository, err := accountdeletioninfra.NewPostgresDeletionRepository(pool, deletionSessionSecret, deletionAnonymousSecret)
	if err != nil {
		return nil, fmt.Errorf("create account deletion repository: %w", err)
	}
	otpRepository, err := accountdeletioninfra.NewPostgresPasswordlessOTPRepository(pool, deletionSessionSecret)
	if err != nil {
		return nil, fmt.Errorf("create account deletion OTP repository: %w", err)
	}
	deletionEmailSender, err := accountdeletioninfra.NewSMTPEmailSender(emailDelivery)
	if err != nil {
		return nil, fmt.Errorf("create account deletion email sender: %w", err)
	}

	groups := []map[string]httpapi.OperationHandler{
		httpapi.SystemHandlers(clock),
		identityHandlers.OperationHandlers(),
		accountdeletionhttp.NewHandlers(
			identityHandlers,
			previewRepository,
			otpRepository,
			deletionEmailSender,
			deletionRepository,
			deletionEmailSender,
			string(authConfiguration.Backend),
			environment.WebOrigin,
			clock,
		).OperationHandlers(),
		accounthttp.NewPersonalAccountHandlers(identityHandlers, personalAccountRepository).OperationHandlers(),
		accounthttp.NewSharedAccountHandlers(identityHandlers, sharedAccountRepository).OperationHandlers(),
		vaultmanagementhttp.NewHandlers(vaultmanagementhttp.Dependencies{
			Authorizer:     identityHandlers,
			Initializer:    personalVaultInitializationService,
			PersonalVaults: personalVaultRepository,
			SharedVaults:   sharedVaultRepository,
			Resets:         destructivePersonalVaultResetRepository,
		}).OperationHandlers(),
		vaultmanagementhttp.NewSharedVaultRecoveryHandlers(identityHandlers, sharedVaultRecoveryRepository).OperationHandlers(),
		vaultmanagementhttp.NewVaultKeyRotationHandlers(identityHandlers, vaultKeyRotationRepository).OperationHandlers(),
		vaultmembershiphttp.NewSharedVaultAccessHandlers(identityHandlers, sharedVaultAccessRepository).OperationHandlers(),
		vaultmembershiphttp.NewMembershipLifecycleHandlers(identityHandlers, membershipLifecycleRepository).OperationHandlers(),
		vaultmembershiphttp.NewSecureShareLinkHandlers(identityHandlers, secureShareLinkRepository).OperationHandlers(),
		vaultmembershiphttp.NewSharedVaultPermissionHandlers(identityHandlers, sharedVaultPermissionRepository).OperationHandlers(),
		vaultmembershiphttp.NewVaultParticipantHandlers(identityHandlers, vaultParticipantRepository).OperationHandlers(),
		audithttp.NewVaultAuditHandlers(identityHandlers, vaultAuditRepository).OperationHandlers(),
		vaultarchivehttp.NewArchiveExportHandlers(identityHandlers, vaultAuditRepository).OperationHandlers(),
		vaultarchivehttp.NewEncryptedVaultImportHandlers(identityHandlers, encryptedVaultImportRepository).OperationHandlers(),
		synchtml.NewHandlers(identityHandlers, workspaceBundleReader).OperationHandlers(),
		retentionhttp.NewHandlers(environment.CronSecret, retentionService, logger, clock, nil).OperationHandlers(),
	}
	handlers, err := mergeOperationHandlers(groups...)
	if err != nil {
		return nil, err
	}
	return httpapi.NewRouter(httpapi.RouterConfig{
		WebOrigin:   environment.WebOrigin,
		ProxySecret: environment.ProxySecret,
		Logger:      logger,
	}, handlers)
}

func createEmailDelivery(
	environment config.Environment,
	authConfiguration identityinfra.AuthConfiguration,
) (identity.EmailDelivery, identityapp.MagicLinkEmailSender, error) {
	if authConfiguration.Backend == identityinfra.AuthBackendNone {
		return unavailableEmailDelivery{}, nil, nil
	}
	if authConfiguration.Backend != identityinfra.AuthBackendPasswordless {
		return nil, nil, errors.New("API authentication backend is unsupported")
	}
	smtpConfiguration, err := identityinfra.ReadSMTPConfiguration(identityinfra.SMTPEnvironment{
		Host:        environment.SMTPHost,
		Port:        environment.SMTPPort,
		Production:  environment.NodeEnvironment == "production",
		Secure:      environment.SMTPSecure,
		RequireTLS:  environment.SMTPRequireTLS,
		Username:    environment.SMTPUser,
		Password:    environment.SMTPPassword,
		TLSCA:       environment.SMTPTLSCA,
		FromAddress: environment.AuthEmailFrom,
		FromName:    environment.AuthEmailFromName,
	})
	if err != nil {
		return nil, nil, fmt.Errorf("read SMTP configuration: %w", err)
	}
	sender, err := identityinfra.NewSMTPEmailSender(smtpConfiguration)
	if err != nil {
		return nil, nil, fmt.Errorf("create SMTP email sender: %w", err)
	}
	return sender, sender, nil
}

func createPasskeyRecoveryWebAuthn(environment config.Environment) *webauthn.WebAuthn {
	if environment.PasskeyRPID == "" || environment.PasskeyOrigin == "" {
		return nil
	}
	configuration, err := identityinfra.ReadPasskeyRecoveryConfiguration(environment.PasskeyRPID, environment.PasskeyOrigin)
	if err != nil {
		return nil
	}
	webAuthn, err := identityinfra.NewPasskeyRecoveryWebAuthn(configuration)
	if err != nil {
		return nil
	}
	return webAuthn
}

func accountDeletionSecrets(configuration identityinfra.AuthConfiguration) ([]byte, []byte, error) {
	if configuration.Backend == identityinfra.AuthBackendPasswordless && configuration.Passwordless != nil {
		return configuration.Passwordless.SessionSecret, configuration.Passwordless.MagicLinkSecret, nil
	}
	sessionSecret := make([]byte, 32)
	if _, err := rand.Read(sessionSecret); err != nil {
		return nil, nil, fmt.Errorf("create local account deletion session key: %w", err)
	}
	anonymousSecret := make([]byte, 32)
	if _, err := rand.Read(anonymousSecret); err != nil {
		clear(sessionSecret)
		return nil, nil, fmt.Errorf("create local account deletion challenge key: %w", err)
	}
	return sessionSecret, anonymousSecret, nil
}

func mergeOperationHandlers(groups ...map[string]httpapi.OperationHandler) (map[string]httpapi.OperationHandler, error) {
	merged := make(map[string]httpapi.OperationHandler)
	for _, group := range groups {
		for operationID, handler := range group {
			if _, exists := merged[operationID]; exists {
				return nil, fmt.Errorf("duplicate API handler for OpenAPI operation %q", operationID)
			}
			merged[operationID] = handler
		}
	}
	return merged, nil
}

type disabledSessionVerifier struct{}

func (disabledSessionVerifier) Verify(context.Context, identityapp.SessionCredentials, identityapp.SessionAssurance) (*identityapp.Principal, error) {
	return nil, nil
}

type unavailableEmailDelivery struct{}

func (unavailableEmailDelivery) SendEmail(context.Context, string, identity.EmailMessage) error {
	return errors.New("email delivery is unavailable")
}

var _ identityapp.SessionVerifier = disabledSessionVerifier{}
var _ identity.EmailDelivery = unavailableEmailDelivery{}
var _ http.Handler = (*echo.Echo)(nil)
