package entity

import (
	"time"
)

const VaultRecoveryDays = 30

func VaultPurgeAfter(deletedAt time.Time) time.Time {
	return deletedAt.Add(VaultRecoveryDays * 24 * time.Hour)
}

func LegacyVaultRecoveryCutoff(now time.Time) time.Time {
	return now.Add(-VaultRecoveryDays * 24 * time.Hour)
}
