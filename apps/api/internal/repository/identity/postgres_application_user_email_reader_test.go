package infrastructure

import (
	"context"
	"testing"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/testsupport"
)

func TestPostgresApplicationUserEmailReaderReturnsOnlyRequestedUsers(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	firstUserID := testsupport.CreateSyntheticApplicationUser(t, pool)
	secondUserID := testsupport.CreateSyntheticApplicationUser(t, pool)
	reader, err := NewPostgresApplicationUserEmailReader(pool)
	if err != nil {
		t.Fatalf("create Application User email reader: %v", err)
	}
	emails, err := reader.ReadApplicationUserEmails(context.Background(), []string{firstUserID, secondUserID, "synthetic-missing-user"})
	if err != nil {
		t.Fatalf("read synthetic Application User emails: %v", err)
	}
	if len(emails) != 2 || emails[firstUserID] != "integration-"+firstUserID+"@example.test" || emails[secondUserID] != "integration-"+secondUserID+"@example.test" {
		t.Fatalf("unexpected Application User email map: %#v", emails)
	}
	empty, err := reader.ReadApplicationUserEmails(context.Background(), nil)
	if err != nil || len(empty) != 0 {
		t.Fatalf("empty email lookup=%#v err=%v", empty, err)
	}
}
