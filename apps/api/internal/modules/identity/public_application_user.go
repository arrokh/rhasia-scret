package identity

import "context"

type ApplicationUserEmailReader interface {
	ReadApplicationUserEmails(context.Context, []string) (map[string]string, error)
}
