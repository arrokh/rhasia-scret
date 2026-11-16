package entity

import (
	"time"
)

const InvitationLifetime = 7 * 24 * time.Hour

func InvitationExpiresAt(createdAt time.Time) time.Time {
	return createdAt.Add(InvitationLifetime)
}

func InvitationIsExpired(expiresAt time.Time, now time.Time) bool {
	return !expiresAt.After(now)
}
