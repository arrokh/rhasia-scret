package postgres

import (
	"errors"
	"fmt"
	"net/url"
	"testing"
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
