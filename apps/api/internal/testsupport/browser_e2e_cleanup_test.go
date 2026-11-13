package testsupport

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

var browserE2EEmailPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._+-]*@browser-e2e\.test$`)

func TestCleanBrowserE2EUsers(t *testing.T) {
	if os.Getenv("RHSIA_BROWSER_E2E_CLEANUP") != "1" {
		t.Skip("explicit browser E2E cleanup is not enabled")
	}
	if os.Getenv("RHSIA_GO_INTEGRATION_DATABASE_URL") == "" {
		t.Fatal("browser E2E cleanup requires a verified disposable PostgreSQL test database")
	}

	emails, err := browserE2ECleanupEmails(os.Getenv("RHSIA_BROWSER_E2E_CLEANUP_EMAILS"))
	if err != nil {
		t.Fatal("browser E2E cleanup email filter is invalid")
	}
	pool := NewDisposablePostgresPool(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	transaction, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal("begin browser E2E cleanup transaction")
	}
	defer func() { _ = transaction.Rollback(ctx) }()

	userIDs, err := browserE2ECleanupIDs(ctx, transaction, `SELECT id FROM application_users WHERE email = ANY($1) OR (cardinality($1::text[]) = 0 AND email LIKE '%@browser-e2e.test')`, emails)
	if err != nil {
		t.Fatal("find synthetic browser E2E users")
	}
	deletionRecordIDs, err := browserE2ECleanupIDs(ctx, transaction, `SELECT id FROM account_deletion_records WHERE email = ANY($1) OR (cardinality($1::text[]) = 0 AND email LIKE '%@browser-e2e.test')`, emails)
	if err != nil {
		t.Fatal("find synthetic browser E2E deletion records")
	}
	vaultIDs, err := browserE2ECleanupIDs(ctx, transaction, `SELECT id FROM vaults WHERE owner_id = ANY($1)`, userIDs)
	if err != nil {
		t.Fatal("find owned synthetic browser E2E Vaults")
	}

	for _, statement := range []struct {
		query string
		args  []any
	}{
		{`DELETE FROM magic_link_challenges WHERE normalized_email = ANY($1) OR (cardinality($1::text[]) = 0 AND normalized_email LIKE '%@browser-e2e.test')`, []any{emails}},
		{`DELETE FROM account_deletion_challenges WHERE application_user_id = ANY($1)`, []any{userIDs}},
		{`DELETE FROM account_deletion_challenges WHERE completed_deletion_id = ANY($1)`, []any{deletionRecordIDs}},
		{`DELETE FROM account_deletion_records WHERE id = ANY($1)`, []any{deletionRecordIDs}},
		{`DELETE FROM vault_audit_events WHERE actor_user_id = ANY($1) OR owner_id = ANY($1) OR target_id = ANY($1) OR vault_id = ANY($2)`, []any{userIDs, vaultIDs}},
		{`DELETE FROM authenticator_accounts WHERE vault_id = ANY($1)`, []any{vaultIDs}},
		{`DELETE FROM vault_invitations WHERE vault_id = ANY($1)`, []any{vaultIDs}},
		{`DELETE FROM vault_members WHERE vault_id = ANY($1)`, []any{vaultIDs}},
		{`DELETE FROM vaults WHERE id = ANY($1)`, []any{vaultIDs}},
		{`DELETE FROM vault_invitations WHERE recipient_user_id = ANY($1)`, []any{userIDs}},
		{`DELETE FROM vault_members WHERE user_id = ANY($1)`, []any{userIDs}},
		{`DELETE FROM passkey_recovery_challenges WHERE user_id = ANY($1)`, []any{userIDs}},
		{`DELETE FROM passkey_recovery_credentials WHERE user_id = ANY($1)`, []any{userIDs}},
		{`DELETE FROM user_crypto_profiles WHERE user_id = ANY($1)`, []any{userIDs}},
		{`DELETE FROM application_rate_limit_windows WHERE user_id = ANY($1)`, []any{userIDs}},
		{`DELETE FROM application_users WHERE id = ANY($1)`, []any{userIDs}},
	} {
		if _, err := transaction.Exec(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("delete synthetic browser E2E rows: %v", err)
		}
	}
	if err := transaction.Commit(ctx); err != nil {
		t.Fatal("commit browser E2E cleanup transaction")
	}
}

func TestBrowserE2ECleanupEmailsAllowsOnlySyntheticDomain(t *testing.T) {
	emails, err := browserE2ECleanupEmails("")
	if err != nil || emails == nil || len(emails) != 0 {
		t.Fatalf("empty cleanup filter must be a non-nil empty array: %#v, %v", emails, err)
	}

	emails, err = browserE2ECleanupEmails(`["owner+scenario@browser-e2e.test"]`)
	if err != nil || len(emails) != 1 || emails[0] != "owner+scenario@browser-e2e.test" {
		t.Fatalf("valid synthetic cleanup filter was rejected: %#v, %v", emails, err)
	}
	for _, input := range []string{`["owner@example.test"]`, `"owner@browser-e2e.test"`, `[]`} {
		if _, err := browserE2ECleanupEmails(input); err == nil {
			t.Errorf("invalid cleanup filter %q was accepted", input)
		}
	}
}

func browserE2ECleanupEmails(value string) ([]string, error) {
	if value == "" {
		return []string{}, nil
	}
	var emails []string
	if err := json.Unmarshal([]byte(value), &emails); err != nil {
		return nil, err
	}
	if len(emails) == 0 {
		return nil, fmt.Errorf("email filter must be empty or contain synthetic browser E2E addresses")
	}
	for _, email := range emails {
		if !browserE2EEmailPattern.MatchString(email) {
			return nil, fmt.Errorf("email filter contains an address outside the synthetic browser E2E domain")
		}
	}
	return emails, nil
}

func browserE2ECleanupIDs(ctx context.Context, transaction pgx.Tx, query string, values []string) ([]string, error) {
	rows, err := transaction.Query(ctx, query, values)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return ids, nil
}
