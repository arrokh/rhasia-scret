package domain

import (
	"testing"
	"time"
)

func TestInvitationExpiryUsesAnExactSevenDayWindow(t *testing.T) {
	createdAt := time.Date(2026, time.July, 29, 12, 0, 0, 0, time.UTC)
	expiresAt := InvitationExpiresAt(createdAt)
	if want := time.Date(2026, time.August, 5, 12, 0, 0, 0, time.UTC); !expiresAt.Equal(want) {
		t.Fatalf("invitation expiry=%s; want %s", expiresAt, want)
	}
	if InvitationIsExpired(expiresAt, expiresAt.Add(-time.Nanosecond)) || !InvitationIsExpired(expiresAt, expiresAt) {
		t.Fatal("invitation expiry boundary must be exclusive at the expiry instant")
	}
}
