package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	apiService "github.com/nooroctavian/rhasia-scret/apps/api/internal/service"
)

type ApplicationUserEmailReader struct {
	pool *pgxpool.Pool
}

func NewApplicationUserEmailReader(pool *pgxpool.Pool) (*ApplicationUserEmailReader, error) {
	if pool == nil {
		return nil, errors.New("Application User email reader is not configured")
	}
	return &ApplicationUserEmailReader{pool: pool}, nil
}

func (reader *ApplicationUserEmailReader) ReadApplicationUserEmails(ctx context.Context, userIDs []string) (map[string]string, error) {
	emails := make(map[string]string, len(userIDs))
	if len(userIDs) == 0 {
		return emails, nil
	}
	rows, err := reader.pool.Query(ctx, `SELECT id, email FROM application_users WHERE id = ANY($1::text[])`, userIDs)
	if err != nil {
		return nil, fmt.Errorf("read Application User emails: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var userID, email string
		if err := rows.Scan(&userID, &email); err != nil {
			return nil, fmt.Errorf("scan Application User email: %w", err)
		}
		emails[userID] = email
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate Application User emails: %w", err)
	}
	return emails, nil
}

var _ apiService.ApplicationUserEmailReader = (*ApplicationUserEmailReader)(nil)
