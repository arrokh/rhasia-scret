package entity

import (
	"testing"
	"time"
)

func TestAuditActionRedactionAndAnnualRetention(t *testing.T) {
	if got := RedactAction(string(ActionAccountAccessed)); got != RedactedAction(ActionAccountAccessed) {
		t.Fatalf("known action was redacted as %q", got)
	}
	if got := RedactAction("FUTURE_UNRECOGNIZED_ACTION"); got != UnknownSecurityActivity {
		t.Fatalf("unknown action was exposed as %q", got)
	}
	deletedAt := time.Date(2024, time.February, 29, 13, 14, 15, 0, time.UTC)
	if got, want := AuditPurgeAfter(deletedAt), time.Date(2025, time.March, 1, 13, 14, 15, 0, time.UTC); !got.Equal(want) {
		t.Fatalf("annual audit purge deadline=%s; want %s", got, want)
	}
}
