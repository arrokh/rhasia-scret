package service

import (
	"context"
	"errors"
	"time"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/localization"
)

const (
	PasswordlessOTPAttemptLimit = 5
	PasswordlessOTPLifetime     = 10 * time.Minute
)

var (
	ErrPasswordlessOTPInvalid = errors.New("account deletion OTP is invalid")
	ErrPasswordlessOTPLocked  = errors.New("account deletion OTP is locked")
	ErrPasswordlessOTPExpired = errors.New("account deletion OTP challenge is unavailable")
)

type PasswordlessOTPChallenge struct {
	ID  string
	OTP string
}

func ValidPasswordlessOTP(otp string) bool {
	if len(otp) != 6 {
		return false
	}
	for _, character := range otp {
		if character < '0' || character > '9' {
			return false
		}
	}
	return true
}

type PasswordlessOTPRepository interface {
	CreatePasswordlessOTPChallenge(context.Context, string, time.Time) (PasswordlessOTPChallenge, error)
	VerifyPasswordlessOTP(context.Context, string, string, time.Time) (string, error)
}

type PasswordlessOTPEmailSender interface {
	SendDeletionOTP(context.Context, string, string, localization.Locale) error
}
