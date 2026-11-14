package infrastructure

import (
	"errors"
	"net/url"
	"strings"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
)

const passkeyRecoveryRPName = "rhasia-scret"

type PasskeyRecoveryConfiguration struct {
	RPID   string
	Origin string
	RPName string
}

func ReadPasskeyRecoveryConfiguration(rpID string, origin string) (PasskeyRecoveryConfiguration, error) {
	rpID = strings.TrimSpace(rpID)
	origin = strings.TrimSpace(origin)
	if rpID == "" || origin == "" {
		return PasskeyRecoveryConfiguration{}, errors.New("passkey recovery relying party configuration is incomplete")
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed == nil || parsed.Scheme == "" || parsed.Host == "" || parsed.User != nil ||
		parsed.Opaque != "" || parsed.Path != "" && parsed.Path != "/" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return PasskeyRecoveryConfiguration{}, errors.New("passkey recovery origin must contain only an origin")
	}
	if parsed.Scheme != "https" && !(parsed.Scheme == "http" && isPasskeyRecoveryLocalhost(parsed.Hostname())) {
		return PasskeyRecoveryConfiguration{}, errors.New("passkey recovery origin must use HTTPS")
	}
	canonicalHost := strings.ToLower(parsed.Host)
	if parsed.Scheme == "https" && parsed.Port() == "443" || parsed.Scheme == "http" && parsed.Port() == "80" {
		canonicalHost = parsed.Hostname()
	}
	canonicalOrigin := parsed.Scheme + "://" + canonicalHost
	if origin != canonicalOrigin {
		return PasskeyRecoveryConfiguration{}, errors.New("passkey recovery origin must be canonical")
	}
	return PasskeyRecoveryConfiguration{RPID: rpID, Origin: canonicalOrigin, RPName: passkeyRecoveryRPName}, nil
}

func NewPasskeyRecoveryWebAuthn(configuration PasskeyRecoveryConfiguration) (*webauthn.WebAuthn, error) {
	if configuration.RPID == "" || configuration.Origin == "" || configuration.RPName != passkeyRecoveryRPName {
		return nil, errors.New("passkey recovery relying party configuration is invalid")
	}
	return webauthn.New(&webauthn.Config{
		RPID:          configuration.RPID,
		RPDisplayName: configuration.RPName,
		RPOrigins:     []string{configuration.Origin},
		AuthenticatorSelection: protocol.AuthenticatorSelection{
			RequireResidentKey: protocol.ResidentKeyRequired(),
			ResidentKey:        protocol.ResidentKeyRequirementRequired,
			UserVerification:   protocol.VerificationRequired,
		},
		AttestationPreference: protocol.PreferNoAttestation,
	})
}

func isPasskeyRecoveryLocalhost(hostname string) bool {
	return strings.EqualFold(hostname, "localhost") || hostname == "127.0.0.1" || hostname == "::1"
}
