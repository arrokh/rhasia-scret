package domain

import "time"

const AccountRecoveryWindow = 30 * 24 * time.Hour

func AccountPurgeAfter(deletedAt time.Time) time.Time {
	return deletedAt.Add(AccountRecoveryWindow)
}

func AccountCanBeRestored(deletedAt time.Time, purgeAfter *time.Time, now time.Time) bool {
	if purgeAfter != nil {
		return purgeAfter.After(now)
	}
	return deletedAt.After(now.Add(-AccountRecoveryWindow))
}
