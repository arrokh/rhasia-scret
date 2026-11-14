package application

import (
	"context"
	"errors"
	"time"
)

const (
	DefaultBatchSize  = 100
	DefaultMaxBatches = 10
	MaximumBatchSize  = 500
	MaximumMaxBatches = 20
)

type PurgeReport struct {
	AccountIDs              []string
	VaultIDs                []string
	AuditEventIDs           []string
	AccountBacklogRemaining bool
	VaultBacklogRemaining   bool
	AuditBacklogRemaining   bool
	AuthRecordsPurged       int64
	AuthBacklogRemaining    bool
}

type RetentionPurgeRepository interface {
	PurgeExpiredAccounts(context.Context, time.Time, int) ([]string, error)
	PurgeExpiredVaults(context.Context, time.Time, int) ([]string, error)
	PurgeExpiredAuditEvents(context.Context, time.Time, int) ([]string, error)
	PurgeExpiredAuthState(context.Context, time.Time, int, int) (int64, bool, error)
}

type Service struct {
	repository RetentionPurgeRepository
}

func NewService(repository RetentionPurgeRepository) *Service {
	return &Service{repository: repository}
}

func (service *Service) Purge(ctx context.Context, now time.Time) (PurgeReport, error) {
	if service == nil {
		return PurgeReport{}, errors.New("retention purge service is unavailable")
	}
	return RunRetentionPurge(ctx, service.repository, now)
}

func RunRetentionPurge(ctx context.Context, repository RetentionPurgeRepository, now time.Time) (PurgeReport, error) {
	if repository == nil {
		return PurgeReport{}, errors.New("retention purge repository is unavailable")
	}
	report := PurgeReport{
		AccountIDs: make([]string, 0), VaultIDs: make([]string, 0), AuditEventIDs: make([]string, 0),
	}
	var err error
	report.AccountIDs, report.AccountBacklogRemaining, err = drain(ctx, repository.PurgeExpiredAccounts, now)
	if err != nil {
		return PurgeReport{}, err
	}
	report.VaultIDs, report.VaultBacklogRemaining, err = drain(ctx, repository.PurgeExpiredVaults, now)
	if err != nil {
		return PurgeReport{}, err
	}
	report.AuditEventIDs, report.AuditBacklogRemaining, err = drain(ctx, repository.PurgeExpiredAuditEvents, now)
	if err != nil {
		return PurgeReport{}, err
	}
	report.AuthRecordsPurged, report.AuthBacklogRemaining, err = repository.PurgeExpiredAuthState(ctx, now, DefaultBatchSize, DefaultMaxBatches)
	if err != nil {
		return PurgeReport{}, err
	}
	return report, nil
}

func drain(
	ctx context.Context,
	purge func(context.Context, time.Time, int) ([]string, error),
	now time.Time,
) ([]string, bool, error) {
	ids := make([]string, 0, DefaultBatchSize*DefaultMaxBatches)
	lastBatchSize := 0
	for batch := 0; batch < DefaultMaxBatches; batch++ {
		purged, err := purge(ctx, now, DefaultBatchSize)
		if err != nil {
			return nil, false, err
		}
		lastBatchSize = len(purged)
		ids = append(ids, purged...)
		if lastBatchSize < DefaultBatchSize {
			return ids, false, nil
		}
	}
	return ids, lastBatchSize == DefaultBatchSize, nil
}
