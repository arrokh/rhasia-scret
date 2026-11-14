package application

import (
	"context"
	"errors"
)

var ErrMembershipUnavailable = errors.New("Shared Vault membership is unavailable")

type MembershipLifecycleRepository interface {
	Revoke(context.Context, string, string, string) error
	Leave(context.Context, string, string) error
}
