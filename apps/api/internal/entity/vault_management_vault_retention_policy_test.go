package entity

import (
	"testing"
	"time"
)

func TestVaultPurgeAfterUsesThirtyDays(t *testing.T) {
	deletedAt := time.Date(2026, time.January, 31, 23, 45, 0, 0, time.UTC)
	want := deletedAt.Add(30 * 24 * time.Hour)
	if got := VaultPurgeAfter(deletedAt); !got.Equal(want) {
		t.Fatalf("VaultPurgeAfter(%v)=%v; want %v", deletedAt, got, want)
	}
}

func TestLegacyVaultRecoveryCutoffUsesThirtyDays(t *testing.T) {
	now := time.Date(2026, time.March, 31, 12, 0, 0, 0, time.UTC)
	want := now.Add(-30 * 24 * time.Hour)
	if got := LegacyVaultRecoveryCutoff(now); !got.Equal(want) {
		t.Fatalf("LegacyVaultRecoveryCutoff(%v)=%v; want %v", now, got, want)
	}
}
