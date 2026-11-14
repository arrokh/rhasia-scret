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
	apiHandler "github.com/nooroctavian/rhasia-scret/apps/api/internal/handler"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	apiRepository "github.com/nooroctavian/rhasia-scret/apps/api/internal/repository"
	apiService "github.com/nooroctavian/rhasia-scret/apps/api/internal/service"
)

func readAuthConfiguration(environment config.Environment) (apiService.AuthConfiguration, error) {
	authEnvironment := apiService.AuthEnvironment{
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
	authConfiguration, err := apiService.ReadAuthConfiguration(authEnvironment)
	if err != nil {
		return apiService.AuthConfiguration{}, fmt.Errorf("read API authentication configuration: %w", err)
	}
	return authConfiguration, nil
}

func newApplicationSessionVerifier(
	environment config.Environment,
	authentication apiService.AuthConfiguration,
	pool *pgxpool.Pool,
	clock func() time.Time,
) (apiService.SessionVerifier, error) {
	e2eVerifier := apiService.NewE2ESessionVerifier(
		environment.NodeEnvironment,
		environment.E2EBrowserTests,
		environment.E2EBrowserTestUsers,
	)
	if e2eVerifier != nil {
		return e2eVerifier, nil
	}
	if authentication.Backend != apiService.AuthBackendPasswordless {
		return disabledSessionVerifier{}, nil
	}
	if authentication.Passwordless == nil {
		return nil, errors.New("passwordless session configuration is unavailable")
	}
	verifier, err := apiRepository.NewSessionVerifier(pool, authentication.Passwordless.SessionSecret, clock)
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
	turnstileConfiguration := apiService.TurnstileConfiguration{}
	if authConfiguration.Backend == apiService.AuthBackendPasswordless {
		turnstileConfiguration = authConfiguration.Turnstile
	} else if authConfiguration.Backend != apiService.AuthBackendNone {
		return nil, errors.New("API authentication backend is unsupported")
	}
	turnstile, err := apiService.NewTurnstileValidator(turnstileConfiguration, nil)
	if err != nil {
		return nil, fmt.Errorf("create Turnstile validator: %w", err)
	}

	applicationRateLimiter, err := apiRepository.NewApplicationRateLimiter(pool)
	if err != nil {
		return nil, fmt.Errorf("create application rate limiter: %w", err)
	}
	allowNewUsers := authConfiguration.Backend == apiService.AuthBackendPasswordless
	userProvisioner, err := apiRepository.NewUserProvisioner(pool, clock, allowNewUsers)
	if err != nil {
		return nil, fmt.Errorf("create Application User provisioner: %w", err)
	}
	sessionVerifier, err := newApplicationSessionVerifier(environment, authConfiguration, pool, clock)
	if err != nil {
		return nil, fmt.Errorf("create passwordless session verifier: %w", err)
	}

	userCryptoProfiles, err := apiRepository.NewUserCryptoProfileRepository(pool, clock)
	if err != nil {
		return nil, fmt.Errorf("create User Crypto Profile repository: %w", err)
	}
	userCryptoProfileService := apiService.NewUserCryptoProfileService(userCryptoProfiles)
	userEncryptionIdentityService := apiService.NewUserEncryptionIdentityService(userCryptoProfiles)
	userEncryptionIdentityRotationRepository, err := apiRepository.NewUserEncryptionIdentityRotationRepository(pool, clock)
	if err != nil {
		return nil, fmt.Errorf("create User Encryption identity rotation repository: %w", err)
	}
	userEncryptionIdentityRotationService := apiService.NewUserEncryptionIdentityRotationService(userEncryptionIdentityRotationRepository)
	passkeyRecovery, err := apiRepository.NewPasskeyRecoveryRepository(pool, clock)
	if err != nil {
		return nil, fmt.Errorf("create Passkey Recovery repository: %w", err)
	}
	passkeyRecoveryWebAuthn := createPasskeyRecoveryWebAuthn(environment)
	if passkeyRecoveryWebAuthn == nil && (environment.PasskeyRPID != "" || environment.PasskeyOrigin != "") {
		logger.Log("warn", "passkey_recovery_configuration_invalid", map[string]any{"requestId": "startup"})
	}

	var passwordlessService apiHandler.PasswordlessService
	var anonymousRateLimiter apiHandler.AnonymousAuthRateLimiter
	if authConfiguration.Backend == apiService.AuthBackendPasswordless {
		passwordlessRepository, repositoryErr := apiRepository.NewPasswordlessAuthRepository(pool, *authConfiguration.Passwordless)
		if repositoryErr != nil {
			return nil, fmt.Errorf("create passwordless authentication repository: %w", repositoryErr)
		}
		passwordlessService, err = apiService.NewPasswordlessAuthService(passwordlessRepository, passwordlessEmailSender, *authConfiguration.Passwordless, clock)
		if err != nil {
			return nil, fmt.Errorf("create passwordless authentication service: %w", err)
		}
		anonymousRateLimiter, err = apiRepository.NewAnonymousAuthRateLimiter(pool, authConfiguration.Passwordless.MagicLinkSecret)
		if err != nil {
			return nil, fmt.Errorf("create anonymous authentication rate limiter: %w", err)
		}
	}

	authenticator := apiService.Authenticator{
		Sessions:    sessionVerifier,
		Users:       userProvisioner,
		RateLimiter: applicationRateLimiter,
	}
	identityHandlers := apiHandler.NewIdentityHandlers(apiHandler.IdentityDependencies{
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

	personalAccountRepository, err := apiRepository.NewPersonalAccountRepository(pool, clock)
	if err != nil {
		return nil, fmt.Errorf("create Personal Account repository: %w", err)
	}
	sharedAccountRepository, err := apiRepository.NewSharedAccountRepository(pool, clock)
	if err != nil {
		return nil, fmt.Errorf("create Shared Account repository: %w", err)
	}

	personalVaultRepository, err := apiRepository.NewPersonalVaultRepository(pool, clock)
	if err != nil {
		return nil, fmt.Errorf("create Personal Vault repository: %w", err)
	}
	sharedVaultRepository, err := apiRepository.NewSharedVaultRepository(pool, clock)
	if err != nil {
		return nil, fmt.Errorf("create Shared Vault repository: %w", err)
	}
	personalVaultInitializer, err := apiRepository.NewPersonalVaultInitializer(pool, clock)
	if err != nil {
		return nil, fmt.Errorf("create Personal Vault initializer: %w", err)
	}
	personalVaultInitializationService := apiService.NewPersonalVaultInitializationService(personalVaultInitializer)
	destructivePersonalVaultResetRepository, err := apiRepository.NewDestructivePersonalVaultResetRepository(pool, clock)
	if err != nil {
		return nil, fmt.Errorf("create destructive Personal Vault reset repository: %w", err)
	}
	sharedVaultRecoveryRepository, err := apiRepository.NewSharedVaultRecoveryRepository(pool, clock)
	if err != nil {
		return nil, fmt.Errorf("create Shared Vault recovery repository: %w", err)
	}
	vaultKeyRotationRepository, err := apiRepository.NewVaultKeyRotationRepository(pool, clock)
	if err != nil {
		return nil, fmt.Errorf("create Vault key rotation repository: %w", err)
	}

	sharedVaultAccessRepository, err := apiRepository.NewSharedVaultAccessRepository(pool)
	if err != nil {
		return nil, fmt.Errorf("create Shared Vault access repository: %w", err)
	}
	membershipLifecycleRepository, err := apiRepository.NewMembershipLifecycleRepository(pool, clock)
	if err != nil {
		return nil, fmt.Errorf("create membership lifecycle repository: %w", err)
	}
	secureShareLinkRepository, err := apiRepository.NewSecureShareLinkRepository(pool, clock)
	if err != nil {
		return nil, fmt.Errorf("create Secure Share Link repository: %w", err)
	}
	sharedVaultPermissionRepository, err := apiRepository.NewSharedVaultAccountPermissionRepository(pool, clock)
	if err != nil {
		return nil, fmt.Errorf("create Shared Vault permission repository: %w", err)
	}
	applicationUserEmailReader, err := apiRepository.NewApplicationUserEmailReader(pool)
	if err != nil {
		return nil, fmt.Errorf("create Application User email reader: %w", err)
	}
	vaultParticipantRepository, err := apiRepository.NewVaultParticipantRepository(pool, applicationUserEmailReader, clock)
	if err != nil {
		return nil, fmt.Errorf("create Vault participant repository: %w", err)
	}

	vaultAuditRepository, err := apiRepository.NewVaultAuditRepository(pool, clock)
	if err != nil {
		return nil, fmt.Errorf("create Vault audit repository: %w", err)
	}
	workspaceBundleReader, err := apiRepository.NewWorkspaceBundleReader(pool, clock)
	if err != nil {
		return nil, fmt.Errorf("create workspace bundle reader: %w", err)
	}
	encryptedVaultImportRepository, err := apiRepository.NewEncryptedVaultImportRepository(pool, clock)
	if err != nil {
		return nil, fmt.Errorf("create encrypted Vault import repository: %w", err)
	}
	retentionRepository, err := apiRepository.NewRetentionPurgeRepository(pool)
	if err != nil {
		return nil, fmt.Errorf("create retention repository: %w", err)
	}
	retentionService := apiService.NewService(retentionRepository)

	deletionSessionSecret, deletionAnonymousSecret, err := accountDeletionSecrets(authConfiguration)
	if err != nil {
		return nil, err
	}
	previewRepository, err := apiRepository.NewPreviewRepository(pool)
	if err != nil {
		return nil, fmt.Errorf("create account deletion preview repository: %w", err)
	}
	deletionRepository, err := apiRepository.NewDeletionRepository(pool, deletionSessionSecret, deletionAnonymousSecret)
	if err != nil {
		return nil, fmt.Errorf("create account deletion repository: %w", err)
	}
	otpRepository, err := apiRepository.NewPasswordlessOTPRepository(pool, deletionSessionSecret)
	if err != nil {
		return nil, fmt.Errorf("create account deletion OTP repository: %w", err)
	}
	deletionEmailSender, err := apiService.NewAccountDeletionSMTPEmailSender(emailDelivery)
	if err != nil {
		return nil, fmt.Errorf("create account deletion email sender: %w", err)
	}

	groups := []map[string]httpapi.OperationHandler{
		httpapi.SystemHandlers(clock),
		identityHandlers.OperationHandlers(),
		apiHandler.NewAccountDeletionHandlers(
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
		apiHandler.NewPersonalAccountHandlers(identityHandlers, personalAccountRepository).OperationHandlers(),
		apiHandler.NewSharedAccountHandlers(identityHandlers, sharedAccountRepository).OperationHandlers(),
		apiHandler.NewVaultManagementHandlers(apiHandler.VaultManagementDependencies{
			Authorizer:     identityHandlers,
			Initializer:    personalVaultInitializationService,
			PersonalVaults: personalVaultRepository,
			SharedVaults:   sharedVaultRepository,
			Resets:         destructivePersonalVaultResetRepository,
		}).OperationHandlers(),
		apiHandler.NewSharedVaultRecoveryHandlers(identityHandlers, sharedVaultRecoveryRepository).OperationHandlers(),
		apiHandler.NewVaultKeyRotationHandlers(identityHandlers, vaultKeyRotationRepository).OperationHandlers(),
		apiHandler.NewSharedVaultAccessHandlers(identityHandlers, sharedVaultAccessRepository).OperationHandlers(),
		apiHandler.NewMembershipLifecycleHandlers(identityHandlers, membershipLifecycleRepository).OperationHandlers(),
		apiHandler.NewSecureShareLinkHandlers(identityHandlers, secureShareLinkRepository).OperationHandlers(),
		apiHandler.NewSharedVaultPermissionHandlers(identityHandlers, sharedVaultPermissionRepository).OperationHandlers(),
		apiHandler.NewVaultParticipantHandlers(identityHandlers, vaultParticipantRepository).OperationHandlers(),
		apiHandler.NewVaultAuditHandlers(identityHandlers, vaultAuditRepository).OperationHandlers(),
		apiHandler.NewArchiveExportHandlers(identityHandlers, vaultAuditRepository).OperationHandlers(),
		apiHandler.NewEncryptedVaultImportHandlers(identityHandlers, encryptedVaultImportRepository).OperationHandlers(),
		apiHandler.NewSyncHandlers(identityHandlers, workspaceBundleReader).OperationHandlers(),
		apiHandler.NewRetentionHandlers(environment.CronSecret, retentionService, logger, clock, nil).OperationHandlers(),
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
	authConfiguration apiService.AuthConfiguration,
) (apiService.EmailDelivery, apiService.MagicLinkEmailSender, error) {
	if authConfiguration.Backend == apiService.AuthBackendNone {
		return unavailableEmailDelivery{}, nil, nil
	}
	if authConfiguration.Backend != apiService.AuthBackendPasswordless {
		return nil, nil, errors.New("API authentication backend is unsupported")
	}
	smtpConfiguration, err := apiService.ReadSMTPConfiguration(apiService.SMTPEnvironment{
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
	sender, err := apiService.NewIdentitySMTPEmailSender(smtpConfiguration)
	if err != nil {
		return nil, nil, fmt.Errorf("create SMTP email sender: %w", err)
	}
	return sender, sender, nil
}

func createPasskeyRecoveryWebAuthn(environment config.Environment) *webauthn.WebAuthn {
	if environment.PasskeyRPID == "" || environment.PasskeyOrigin == "" {
		return nil
	}
	configuration, err := apiService.ReadPasskeyRecoveryConfiguration(environment.PasskeyRPID, environment.PasskeyOrigin)
	if err != nil {
		return nil
	}
	webAuthn, err := apiService.NewPasskeyRecoveryWebAuthn(configuration)
	if err != nil {
		return nil
	}
	return webAuthn
}

func accountDeletionSecrets(configuration apiService.AuthConfiguration) ([]byte, []byte, error) {
	if configuration.Backend == apiService.AuthBackendPasswordless && configuration.Passwordless != nil {
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

func (disabledSessionVerifier) Verify(context.Context, apiService.SessionCredentials, apiService.SessionAssurance) (*apiService.Principal, error) {
	return nil, nil
}

type unavailableEmailDelivery struct{}

func (unavailableEmailDelivery) SendEmail(context.Context, string, apiService.EmailMessage) error {
	return errors.New("email delivery is unavailable")
}

var _ apiService.SessionVerifier = disabledSessionVerifier{}
var _ apiService.EmailDelivery = unavailableEmailDelivery{}
var _ http.Handler = (*echo.Echo)(nil)
