package postgres

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const APIConnectionLimit int32 = 5

const (
	apiConnectionTimeout = 5 * time.Second
	apiPingTimeout       = time.Second
)

var ErrInvalidDatabaseURL = errors.New("invalid API database URL")

func ParseRuntimePoolConfig(databaseURL string) (*pgxpool.Config, error) {
	normalized, err := normalizeDatabaseURL(databaseURL)
	if err != nil {
		return nil, err
	}
	config, err := pgxpool.ParseConfig(normalized)
	if err != nil {
		return nil, fmt.Errorf("parse API database configuration: %w", err)
	}
	config.MaxConns = APIConnectionLimit
	// Bound idle health pings and replacement dials instead of pgxpool's untimed ping/two-minute dial defaults.
	if config.ConnConfig.ConnectTimeout <= 0 && !hasDatabaseURLParameter(normalized, "connect_timeout") {
		config.ConnConfig.ConnectTimeout = apiConnectionTimeout
	}
	if config.PingTimeout <= 0 && !hasDatabaseURLParameter(normalized, "pool_ping_timeout") {
		config.PingTimeout = apiPingTimeout
	}
	return config, nil
}

func OpenPool(databaseURL string) (*pgxpool.Pool, error) {
	config, err := ParseRuntimePoolConfig(databaseURL)
	if err != nil {
		return nil, err
	}
	pool, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		return nil, fmt.Errorf("create API database pool: %w", err)
	}
	return pool, nil
}

func hasDatabaseURLParameter(databaseURL, parameter string) bool {
	parsed, err := url.Parse(databaseURL)
	return err == nil && parsed.Query().Has(parameter)
}

func normalizeDatabaseURL(databaseURL string) (string, error) {
	databaseURL = strings.TrimSpace(databaseURL)
	if databaseURL == "" {
		return "", ErrInvalidDatabaseURL
	}
	parsed, err := url.Parse(databaseURL)
	if err != nil || (parsed.Scheme != "postgres" && parsed.Scheme != "postgresql") || parsed.Host == "" || parsed.Path == "/" || parsed.Path == "" {
		return "", ErrInvalidDatabaseURL
	}

	query := parsed.Query()
	schemas := query["schema"]
	if len(schemas) > 1 || (len(schemas) == 1 && schemas[0] != "public") {
		return "", ErrInvalidDatabaseURL
	}
	query.Del("schema")
	parsed.RawQuery = query.Encode()
	return parsed.String(), nil
}
