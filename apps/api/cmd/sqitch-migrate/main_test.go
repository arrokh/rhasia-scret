package main

import (
	"strings"
	"testing"
)

func TestDeriveSqitchConfigurationConvertsPrismaPostgresURL(t *testing.T) {
	t.Parallel()

	target, environment, err := deriveSqitchConfiguration("postgresql://synthetic:qqqqqqqq@db.example.test:5433/vault_db?schema=public&sslmode=require&connect_timeout=5")
	if err != nil {
		t.Fatalf("deriveSqitchConfiguration(): %v", err)
	}
	if target != "db:pg://db.example.test:5433/vault_db" {
		t.Fatalf("target = %q; want credential-free direct target", target)
	}
	for name, want := range map[string]string{
		"PGHOST":            "db.example.test",
		"PGPORT":            "5433",
		"PGDATABASE":        "vault_db",
		"PGUSER":            "synthetic",
		"PGPASSWORD":        "qqqqqqqq",
		"PGSSLMODE":         "require",
		"PGCONNECT_TIMEOUT": "5",
		"PGOPTIONS":         "-c search_path=public",
	} {
		if environment[name] != want {
			t.Errorf("%s = %q; want %q", name, environment[name], want)
		}
	}
	if strings.Contains(target, "synthetic") || strings.Contains(target, "qqqqqqqq") {
		t.Fatal("Sqitch target must not contain credentials")
	}
}

func TestDeriveSqitchConfigurationSupportsIPv6AndProviderOptions(t *testing.T) {
	t.Parallel()

	target, environment, err := deriveSqitchConfiguration("postgres://user:qqqqqqqq@[2001:db8::1]/postgres?schema=public&options=-c%20statement_timeout%3D5000")
	if err != nil {
		t.Fatalf("deriveSqitchConfiguration(): %v", err)
	}
	if target != "db:pg://[2001:db8::1]:5432/postgres" {
		t.Fatalf("target = %q; want IPv6 target", target)
	}
	if environment["PGOPTIONS"] != "-c statement_timeout=5000 -c search_path=public" {
		t.Fatalf("PGOPTIONS = %q", environment["PGOPTIONS"])
	}
}

func TestDeriveSqitchConfigurationRejectsUnsafeOrUnsupportedURLs(t *testing.T) {
	t.Parallel()

	for name, connection := range map[string]string{
		"empty":               "",
		"wrong scheme":        "https://synthetic.invalid/database",
		"missing user":        "postgresql://db.internal/vault_db",
		"missing database":    "postgresql://synthetic@db.internal",
		"unsupported schema":  "postgresql://synthetic@db.internal/vault_db?schema=private",
		"duplicate schema":    "postgresql://synthetic@db.internal/vault_db?schema=public&schema=public",
		"unsupported setting": "postgresql://synthetic@db.internal/vault_db?password=secret",
		"invalid port":        "postgresql://synthetic@db.internal:70000/vault_db",
		"invalid database":    "postgresql://synthetic@db.internal/vault%2Fdb",
		"fragment":            "postgresql://synthetic@db.internal/vault_db#fragment",
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			if _, _, err := deriveSqitchConfiguration(connection); err == nil {
				t.Fatal("deriveSqitchConfiguration() succeeded for invalid URL")
			}
		})
	}
}

func TestMigrationEnvironmentRemovesRuntimeAndInheritedPostgresURLs(t *testing.T) {
	t.Parallel()

	environment := migrationEnvironment([]string{
		"PATH=/usr/bin",
		"DIRECT_URL=postgresql://private.invalid/secret",
		"DATABASE_URL=postgresql://private.invalid/runtime",
		"SQITCH_TARGET=db:pg://wrong:5432/wrong",
		"PGHOST=wrong",
		"NODE_ENV=production",
	}, "db:pg://right:5432/vault_db", map[string]string{
		"PGHOST":     "right",
		"PGDATABASE": "vault_db",
		"PGUSER":     "synthetic",
	})
	joined := strings.Join(environment, "\n")
	for _, forbidden := range []string{"DIRECT_URL=", "DATABASE_URL=", "private.invalid", "wrong:5432", "PGHOST=wrong"} {
		if strings.Contains(joined, forbidden) {
			t.Errorf("migration environment contains %q", forbidden)
		}
	}
	for _, expected := range []string{"PATH=/usr/bin", "NODE_ENV=production", "SQITCH_TARGET=db:pg://right:5432/vault_db", "PGHOST=right"} {
		if !strings.Contains(joined, expected) {
			t.Errorf("migration environment is missing %q", expected)
		}
	}
}
