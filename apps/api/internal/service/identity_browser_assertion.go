package service

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

type browserAssertionHeader struct {
	Algorithm string `json:"alg"`
	Type      string `json:"typ"`
}

type browserAssertionClaims struct {
	SessionID string `json:"session_id"`
	Issuer    string `json:"iss"`
	Audience  string `json:"aud"`
	IssuedAt  int64  `json:"iat"`
	ExpiresAt int64  `json:"exp"`
}

func SignBrowserAssertion(secret []byte, sessionID string, now time.Time, expiresAt time.Time) (string, error) {
	if len(secret) < 32 || !sessionIDPattern.MatchString(sessionID) {
		return "", errors.New("browser session identifier or signing key is invalid")
	}
	maximumExpiry := now.Add(PasswordlessAssertionMaxAgeSeconds * time.Second)
	if expiresAt.After(maximumExpiry) {
		expiresAt = maximumExpiry
	}
	if !expiresAt.After(now) {
		return "", errors.New("browser session is expired")
	}
	header, err := json.Marshal(browserAssertionHeader{Algorithm: "HS256", Type: "JWT"})
	if err != nil {
		return "", fmt.Errorf("encode browser assertion header: %w", err)
	}
	claims, err := json.Marshal(browserAssertionClaims{
		SessionID: sessionID,
		Issuer:    PasswordlessAssertionIssuer,
		Audience:  PasswordlessAssertionAudience,
		IssuedAt:  now.Unix(),
		ExpiresAt: expiresAt.Unix(),
	})
	if err != nil {
		return "", fmt.Errorf("encode browser assertion claims: %w", err)
	}
	encodedHeader := base64.RawURLEncoding.EncodeToString(header)
	encodedClaims := base64.RawURLEncoding.EncodeToString(claims)
	unsigned := encodedHeader + "." + encodedClaims
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte(unsigned))
	return unsigned + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}

func VerifyBrowserAssertion(secret []byte, token string, now time.Time) (string, error) {
	if len(secret) < 32 || token == "" || len(token) > 8192 {
		return "", errors.New("browser assertion is invalid")
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return "", errors.New("browser assertion is invalid")
	}
	decoder := base64.RawURLEncoding.Strict()
	headerBytes, err := decoder.DecodeString(parts[0])
	if err != nil {
		return "", errors.New("browser assertion is invalid")
	}
	claimsBytes, err := decoder.DecodeString(parts[1])
	if err != nil {
		return "", errors.New("browser assertion is invalid")
	}
	signature, err := decoder.DecodeString(parts[2])
	if err != nil {
		return "", errors.New("browser assertion is invalid")
	}
	var header browserAssertionHeader
	if json.Unmarshal(headerBytes, &header) != nil || header.Algorithm != "HS256" {
		return "", errors.New("browser assertion is invalid")
	}
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte(parts[0] + "." + parts[1]))
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return "", errors.New("browser assertion is invalid")
	}
	var claims browserAssertionClaims
	if json.Unmarshal(claimsBytes, &claims) != nil ||
		!sessionIDPattern.MatchString(claims.SessionID) ||
		claims.Issuer != PasswordlessAssertionIssuer ||
		claims.Audience != PasswordlessAssertionAudience ||
		claims.ExpiresAt <= now.Unix() {
		return "", errors.New("browser assertion is invalid")
	}
	return claims.SessionID, nil
}
