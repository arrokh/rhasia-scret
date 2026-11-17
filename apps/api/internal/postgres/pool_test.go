package postgres

import (
	"errors"
	"fmt"
	"net/url"
	"testing"
	"time"
)

func TestParseRuntimePoolConfigStripsOnlySupportedPrismaSchemaParameter(t *testing.T) {
	t.Parallel()

	databaseURL := "postgresql://synthetic:synthetic@127.0.0.1:5432/synthetic?schema=public&sslmode=disable"
	config, err := ParseRuntimePoolConfig(databaseURL)
	if err != nil {
		t.Fatalf("ParseRuntimePoolConfig(): %v", err)
	}
	if config.MaxConns != APIConnectionLimit {
		t.Fatalf("MaxConns = %d; want %d", config.MaxConns, APIConnectionLimit)
	}
	normalized, err := normalizeDatabaseURL(databaseURL)
	if err != nil {
		t.Fatalf("normalizeDatabaseURL(): %v", err)
	}
	parsed, err := url.Parse(normalized)
	if err != nil {
		t.Fatalf("parse normalized connection string: %v", err)
	}
	if parsed.Query().Has("schema") {
		t.Fatal("Prisma-only schema query parameter was passed to pgx")
	}
}

func TestParseRuntimePoolConfigBoundsConnectionRecovery(t *testing.T) {
	t.Parallel()

	config, err := ParseRuntimePoolConfig("postgresql://synthetic:synthetic@127.0.0.1:5432/synthetic?sslmode=disable")
	if err != nil {
		t.Fatalf("ParseRuntimePoolConfig(): %v", err)
	}
	if config.PingTimeout != time.Second {
		t.Errorf("PingTimeout = %s; want %s", config.PingTimeout, time.Second)
	}
	if config.ConnConfig.ConnectTimeout != 5*time.Second {
		t.Errorf("ConnectTimeout = %s; want %s", config.ConnConfig.ConnectTimeout, 5*time.Second)
	}
}

func TestParseRuntimePoolConfigPreservesExplicitConnectionTimeouts(t *testing.T) {
	t.Parallel()

	for _, testCase := range []struct {
		name           string
		query          string
		connectTimeout time.Duration
		pingTimeout    time.Duration
	}{
		{
			name:           "custom timeouts",
			query:          "connect_timeout=9&pool_ping_timeout=2s",
			connectTimeout: 9 * time.Second,
			pingTimeout:    2 * time.Second,
		},
		{
			name:  "explicit zero values",
			query: "connect_timeout=0&pool_ping_timeout=0",
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			config, err := ParseRuntimePoolConfig("postgresql://synthetic:synthetic@127.0.0.1:5432/synthetic?" + testCase.query)
			if err != nil {
				t.Fatalf("ParseRuntimePoolConfig(): %v", err)
			}
			if config.ConnConfig.ConnectTimeout != testCase.connectTimeout {
				t.Errorf("ConnectTimeout = %s; want %s", config.ConnConfig.ConnectTimeout, testCase.connectTimeout)
			}
			if config.PingTimeout != testCase.pingTimeout {
				t.Errorf("PingTimeout = %s; want %s", config.PingTimeout, testCase.pingTimeout)
			}
		})
	}
}

func TestParseRuntimePoolConfigRejectsMissingOrUnsupportedDatabaseSchema(t *testing.T) {
	t.Parallel()

	for index, databaseURL := range []string{
		"",
		"https://synthetic.example.test/database",
		"postgresql://127.0.0.1/",
		"postgresql://127.0.0.1/synthetic?schema=private",
		"postgresql://127.0.0.1/synthetic?schema=public&schema=private",
	} {
		t.Run(fmt.Sprintf("case-%d", index), func(t *testing.T) {
			t.Parallel()
			if _, err := ParseRuntimePoolConfig(databaseURL); !errors.Is(err, ErrInvalidDatabaseURL) {
				t.Fatalf("ParseRuntimePoolConfig() error = %v; want ErrInvalidDatabaseURL", err)
			}
		})
	}
}
