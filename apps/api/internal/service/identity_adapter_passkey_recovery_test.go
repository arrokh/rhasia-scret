package service

import (
	"encoding/base64"
	"encoding/json"
	"testing"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
)

func TestReadPasskeyRecoveryConfiguration(t *testing.T) {
	valid := []struct {
		name   string
		rpID   string
		origin string
	}{
		{name: "remote TLS origin", rpID: "web.example.test", origin: "https://web.example.test"},
		{name: "localhost origin", rpID: "localhost", origin: "http://localhost:3000"},
	}
	for _, test := range valid {
		t.Run(test.name, func(t *testing.T) {
			configuration, err := ReadPasskeyRecoveryConfiguration(test.rpID, test.origin)
			if err != nil {
				t.Fatalf("read configuration: %v", err)
			}
			if configuration.RPID != test.rpID || configuration.Origin != test.origin || configuration.RPName != passkeyRecoveryRPName {
				t.Fatalf("unexpected configuration: %#v", configuration)
			}
			webAuthn, err := NewPasskeyRecoveryWebAuthn(configuration)
			if err != nil {
				t.Fatalf("create WebAuthn relying party: %v", err)
			}
			if webAuthn.Config.AuthenticatorSelection.ResidentKey != protocol.ResidentKeyRequirementRequired ||
				webAuthn.Config.AuthenticatorSelection.RequireResidentKey == nil || !*webAuthn.Config.AuthenticatorSelection.RequireResidentKey ||
				webAuthn.Config.AuthenticatorSelection.UserVerification != protocol.VerificationRequired {
				t.Fatalf("WebAuthn configuration does not require a verified resident credential: %#v", webAuthn.Config.AuthenticatorSelection)
			}
		})
	}

	invalid := []struct {
		name   string
		rpID   string
		origin string
	}{
		{name: "missing RP ID", origin: "https://web.example.test"},
		{name: "missing origin", rpID: "web.example.test"},
		{name: "remote HTTP", rpID: "web.example.test", origin: "http://web.example.test"},
		{name: "path", rpID: "web.example.test", origin: "https://web.example.test/path"},
		{name: "trailing slash", rpID: "web.example.test", origin: "https://web.example.test/"},
		{name: "query", rpID: "web.example.test", origin: "https://web.example.test?x=1"},
		{name: "userinfo", rpID: "web.example.test", origin: "https://user@web.example.test"},
		{name: "noncanonical host", rpID: "web.example.test", origin: "https://WEB.EXAMPLE.TEST"},
	}
	for _, test := range invalid {
		t.Run("rejects "+test.name, func(t *testing.T) {
			if _, err := ReadPasskeyRecoveryConfiguration(test.rpID, test.origin); err == nil {
				t.Fatal("expected invalid passkey recovery configuration to fail")
			}
		})
	}
}

func TestPasskeyRecoveryWebAuthnOptionsMatchBrowserContract(t *testing.T) {
	configuration, err := ReadPasskeyRecoveryConfiguration("web.example.test", "https://web.example.test")
	if err != nil {
		t.Fatalf("read relying party configuration: %v", err)
	}
	webAuthn, err := NewPasskeyRecoveryWebAuthn(configuration)
	if err != nil {
		t.Fatalf("create WebAuthn relying party: %v", err)
	}
	user := passkeyRecoveryOptionsTestUser{}
	creation, _, err := webAuthn.BeginRegistration(user, webauthn.WithExtensions(webauthn.WithExtensionPRFSupport()))
	if err != nil {
		t.Fatalf("begin registration: %v", err)
	}
	encoded, err := json.Marshal(creation.Response)
	if err != nil {
		t.Fatalf("marshal registration options: %v", err)
	}
	var registration map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &registration); err != nil {
		t.Fatalf("decode registration options: %v", err)
	}
	var relyingParty map[string]string
	if err := json.Unmarshal(registration["rp"], &relyingParty); err != nil || relyingParty["id"] != "web.example.test" || relyingParty["name"] != passkeyRecoveryRPName {
		t.Fatalf("unexpected relying party entity: %#v (%v)", relyingParty, err)
	}
	var selection protocol.AuthenticatorSelection
	if err := json.Unmarshal(registration["authenticatorSelection"], &selection); err != nil ||
		selection.ResidentKey != protocol.ResidentKeyRequirementRequired || selection.UserVerification != protocol.VerificationRequired ||
		selection.RequireResidentKey == nil || !*selection.RequireResidentKey {
		t.Fatalf("unexpected authenticator selection: %#v (%v)", selection, err)
	}
	var extensions map[string]json.RawMessage
	if err := json.Unmarshal(registration["extensions"], &extensions); err != nil || string(extensions[protocol.ExtensionPRF]) != "{}" {
		t.Fatalf("registration does not request only the PRF capability probe: %#v (%v)", extensions, err)
	}

	assertion, _, err := webAuthn.BeginLogin(passkeyRecoveryOptionsTestUser{credentials: []webauthn.Credential{{ID: []byte{1, 2, 3, 4}}}})
	if err != nil {
		t.Fatalf("begin authentication: %v", err)
	}
	if assertion.Response.UserVerification != protocol.VerificationRequired || len(assertion.Response.AllowedCredentials) != 1 ||
		string(assertion.Response.AllowedCredentials[0].CredentialID) != string([]byte{1, 2, 3, 4}) ||
		len(assertion.Response.AllowedCredentials[0].Transport) != 0 {
		t.Fatalf("unexpected authentication options: %#v", assertion.Response)
	}
}

type passkeyRecoveryOptionsTestUser struct {
	credentials []webauthn.Credential
}

func (passkeyRecoveryOptionsTestUser) WebAuthnID() []byte {
	return []byte("synthetic-user")
}

func (passkeyRecoveryOptionsTestUser) WebAuthnName() string {
	return "person@example.test"
}

func (passkeyRecoveryOptionsTestUser) WebAuthnDisplayName() string {
	return "person@example.test"
}

func (user passkeyRecoveryOptionsTestUser) WebAuthnCredentials() []webauthn.Credential {
	return user.credentials
}

func TestBrowserE2EPasskeyVerificationIsExplicitlyDevelopmentOnly(t *testing.T) {
	credentialID := []byte{1, 2, 3, 4, 5}
	encodedID := base64.RawURLEncoding.EncodeToString(credentialID)
	registration := []byte(`{"id":"` + encodedID + `","type":"public-key","clientExtensionResults":{"browserE2eTest":true,"prf":{"enabled":true}}}`)
	if _, accepted := BrowserE2ERegistrationCredential(registration, "production", "1"); accepted {
		t.Fatal("production enabled the fake passkey registration")
	}
	if _, accepted := BrowserE2ERegistrationCredential(registration, "development", "true"); accepted {
		t.Fatal("non-exact test flag enabled the fake passkey registration")
	}
	decodedID, accepted := BrowserE2ERegistrationCredential(registration, "development", "1")
	if !accepted || string(decodedID) != string(credentialID) {
		t.Fatalf("development test registration was rejected or changed ID: %x %v", decodedID, accepted)
	}

	authentication := []byte(`{"id":"` + encodedID + `","type":"public-key","clientExtensionResults":{"browserE2eTest":true},"response":{}}`)
	if BrowserE2EAuthenticationVerified(authentication, credentialID, "production", "1") {
		t.Fatal("production enabled the fake passkey assertion")
	}
	if !BrowserE2EAuthenticationVerified(authentication, credentialID, "development", "1") {
		t.Fatal("valid development test assertion was rejected")
	}
	withUserHandle := []byte(`{"id":"` + encodedID + `","type":"public-key","clientExtensionResults":{"browserE2eTest":true},"response":{"userHandle":null}}`)
	if BrowserE2EAuthenticationVerified(withUserHandle, credentialID, "development", "1") {
		t.Fatal("fake assertion with a userHandle was accepted")
	}
}

func TestBrowserE2EPasskeyRegistrationBoundsCredentialID(t *testing.T) {
	invalidIDs := []string{"", base64.RawURLEncoding.EncodeToString([]byte{1, 2, 3}), base64.RawURLEncoding.EncodeToString(make([]byte, 129))}
	for _, id := range invalidIDs {
		response := []byte(`{"id":"` + id + `","type":"public-key","clientExtensionResults":{"browserE2eTest":true,"prf":{"enabled":true}}}`)
		if _, accepted := BrowserE2ERegistrationCredential(response, "development", "1"); accepted {
			t.Errorf("fake registration accepted credential ID of decoded length %d", len(id))
		}
	}
}
