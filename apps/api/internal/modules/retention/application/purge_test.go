package application

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"
)

type retentionRepositoryStub struct {
	calls          []string
	accountBatches [][]string
	vaultBatches   [][]string
	auditBatches   [][]string
	authCount      int64
	authBacklog    bool
	fail           string
}

func (repository *retentionRepositoryStub) PurgeExpiredAccounts(_ context.Context, _ time.Time, _ int) ([]string, error) {
	repository.calls = append(repository.calls, "accounts")
	return nextRetentionBatch(repository.accountBatches, len(repository.calls)-1, repository.fail, "accounts")
}

func (repository *retentionRepositoryStub) PurgeExpiredVaults(_ context.Context, _ time.Time, _ int) ([]string, error) {
	repository.calls = append(repository.calls, "vaults")
	index := countRetentionCalls(repository.calls, "vaults") - 1
	return nextRetentionBatch(repository.vaultBatches, index, repository.fail, "vaults")
}

func (repository *retentionRepositoryStub) PurgeExpiredAuditEvents(_ context.Context, _ time.Time, _ int) ([]string, error) {
	repository.calls = append(repository.calls, "audit")
	index := countRetentionCalls(repository.calls, "audit") - 1
	return nextRetentionBatch(repository.auditBatches, index, repository.fail, "audit")
}

func (repository *retentionRepositoryStub) PurgeExpiredAuthState(_ context.Context, _ time.Time, _ int, _ int) (int64, bool, error) {
	repository.calls = append(repository.calls, "auth")
	if repository.fail == "auth" {
		return 0, false, errors.New("synthetic failure")
	}
	return repository.authCount, repository.authBacklog, nil
}

func TestRunRetentionPurgeDrainsBatchesInOrderAndReportsBacklog(t *testing.T) {
	full := make([]string, DefaultBatchSize)
	for index := range full {
		full[index] = "synthetic-account-id"
	}
	repository := &retentionRepositoryStub{
		accountBatches: [][]string{full, {"synthetic-account-last"}},
		vaultBatches:   [][]string{full, full, full, full, full, full, full, full, full, full},
		auditBatches:   [][]string{{"synthetic-audit-id"}}, authCount: 8, authBacklog: true,
	}
	now := time.Date(2026, time.August, 1, 2, 3, 4, 0, time.UTC)
	report, err := RunRetentionPurge(context.Background(), repository, now)
	if err != nil {
		t.Fatalf("run retention purge: %v", err)
	}
	if len(report.AccountIDs) != 101 || report.AccountBacklogRemaining || len(report.VaultIDs) != DefaultBatchSize*DefaultMaxBatches ||
		!report.VaultBacklogRemaining || len(report.AuditEventIDs) != 1 || report.AuditBacklogRemaining || report.AuthRecordsPurged != 8 || !report.AuthBacklogRemaining {
		t.Fatalf("retention purge report=%#v", report)
	}
	if got, want := repository.calls[:3], []string{"accounts", "accounts", "vaults"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("purge order prefix=%v; want %v", got, want)
	}
	wantSuffix := []string{"audit", "auth"}
	gotSuffix := repository.calls[len(repository.calls)-len(wantSuffix):]
	if !reflect.DeepEqual(gotSuffix, wantSuffix) {
		t.Fatalf("purge order suffix=%v; want %v", gotSuffix, wantSuffix)
	}
}

func TestRunRetentionPurgeStopsAtFirstFailure(t *testing.T) {
	repository := &retentionRepositoryStub{fail: "vaults", accountBatches: [][]string{{"synthetic-account"}}}
	_, err := RunRetentionPurge(context.Background(), repository, time.Now())
	if err == nil || !reflect.DeepEqual(repository.calls, []string{"accounts", "vaults"}) {
		t.Fatalf("purge calls=%v err=%v; want stop at vault failure", repository.calls, err)
	}
}

func nextRetentionBatch(batches [][]string, index int, fail string, name string) ([]string, error) {
	if fail == name {
		return nil, errors.New("synthetic failure")
	}
	if index >= len(batches) {
		return []string{}, nil
	}
	return batches[index], nil
}

func countRetentionCalls(calls []string, target string) int {
	count := 0
	for _, current := range calls {
		if current == target {
			count++
		}
	}
	return count
}
