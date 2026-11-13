package application

import "context"

type SharedVaultRecoveryRepository interface {
	Delete(context.Context, string, string) (bool, error)
	Restore(context.Context, string, string) (bool, error)
}
