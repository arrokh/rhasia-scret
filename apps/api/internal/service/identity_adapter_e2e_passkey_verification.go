package service

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
)

func BrowserE2ERegistrationCredential(response []byte, nodeEnvironment string, enabled string) ([]byte, bool) {
	if !BrowserE2ETestsEnabled(nodeEnvironment, enabled) {
		return nil, false
	}
	fields, ok := passkeyJSONObject(response)
	if !ok {
		return nil, false
	}
	var id string
	var credentialType string
	if json.Unmarshal(fields["id"], &id) != nil || json.Unmarshal(fields["type"], &credentialType) != nil ||
		credentialType != "public-key" || id == "" {
		return nil, false
	}
	clientExtensions, ok := passkeyJSONObject(fields["clientExtensionResults"])
	if !ok || !passkeyJSONBoolean(clientExtensions["browserE2eTest"], true) {
		return nil, false
	}
	prf, ok := passkeyJSONObject(clientExtensions["prf"])
	if !ok || !passkeyJSONBoolean(prf["enabled"], true) {
		return nil, false
	}
	credentialID, err := base64.RawURLEncoding.Strict().DecodeString(id)
	if err != nil || len(credentialID) < 4 || len(credentialID) > 128 || base64.RawURLEncoding.EncodeToString(credentialID) != id {
		clear(credentialID)
		return nil, false
	}
	return credentialID, true
}

func BrowserE2EAuthenticationVerified(response []byte, expectedCredentialID []byte, nodeEnvironment string, enabled string) bool {
	if !BrowserE2ETestsEnabled(nodeEnvironment, enabled) {
		return false
	}
	fields, ok := passkeyJSONObject(response)
	if !ok {
		return false
	}
	var id string
	var credentialType string
	if json.Unmarshal(fields["id"], &id) != nil || json.Unmarshal(fields["type"], &credentialType) != nil ||
		credentialType != "public-key" || id != base64.RawURLEncoding.EncodeToString(expectedCredentialID) {
		return false
	}
	clientExtensions, ok := passkeyJSONObject(fields["clientExtensionResults"])
	if !ok || !passkeyJSONBoolean(clientExtensions["browserE2eTest"], true) {
		return false
	}
	assertion, ok := passkeyJSONObject(fields["response"])
	if !ok {
		return false
	}
	_, userHandlePresent := assertion["userHandle"]
	return !userHandlePresent
}

func BrowserE2ETestsEnabled(nodeEnvironment string, enabled string) bool {
	return nodeEnvironment == "development" && enabled == "1"
}

func passkeyJSONObject(raw json.RawMessage) (map[string]json.RawMessage, bool) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return nil, false
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(trimmed, &fields); err != nil || fields == nil {
		return nil, false
	}
	return fields, true
}

func passkeyJSONBoolean(raw json.RawMessage, expected bool) bool {
	var value bool
	return json.Unmarshal(raw, &value) == nil && value == expected && bytes.Equal(bytes.TrimSpace(raw), []byte("true")) == expected
}
