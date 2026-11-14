package infrastructure

import (
	"regexp"
	"testing"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/postgres"
	identityapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/service/identity"
)

func TestPostgresUserProvisionerAdmissionOnlyAllowsVerifiedNewUsersWhenConfigured(t *testing.T) {
	principal := identityapp.Principal{EmailVerified: true}
	if (&PostgresUserProvisioner{allowNewUsers: false}).canProvisionNewUser(principal) {
		t.Fatal("admitted a new application user when backend policy is disabled")
	}
	if !(&PostgresUserProvisioner{allowNewUsers: true}).canProvisionNewUser(principal) {
		t.Fatal("rejected a verified new application user for the passwordless backend")
	}
	principal.EmailVerified = false
	if (&PostgresUserProvisioner{allowNewUsers: true}).canProvisionNewUser(principal) {
		t.Fatal("admitted a new application user with an unverified email")
	}
}

func TestNewCUIDUsesCUIDCompatibleShape(t *testing.T) {
	pattern := regexp.MustCompile(`^c[a-z0-9]{24}$`)
	first, err := postgres.NewCUID()
	if err != nil {
		t.Fatalf("generate first application ID: %v", err)
	}
	second, err := postgres.NewCUID()
	if err != nil {
		t.Fatalf("generate second application ID: %v", err)
	}
	if !pattern.MatchString(first) || !pattern.MatchString(second) {
		t.Fatalf("generated IDs are not CUID-compatible: %q, %q", first, second)
	}
	if first == second {
		t.Fatal("generated duplicate application IDs")
	}
}
