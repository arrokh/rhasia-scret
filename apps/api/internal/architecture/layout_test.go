package architecture

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestImplementationPackagesUseLayerFirstDirectories(t *testing.T) {
	_, sourcePath, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("locate API architecture test source")
	}
	apiRoot := filepath.Clean(filepath.Join(filepath.Dir(sourcePath), "../.."))
	internalRoot := filepath.Join(apiRoot, "internal")

	for _, layer := range []string{"adapter", "app", "entity", "handler", "repository", "service"} {
		path := filepath.Join(internalRoot, layer)
		info, err := os.Stat(path)
		if err != nil || !info.IsDir() {
			t.Errorf("horizontal API layer %q is missing", layer)
		}
	}
	compositionPath := filepath.Join(internalRoot, "app", "api")
	if info, err := os.Stat(compositionPath); err != nil || !info.IsDir() {
		t.Errorf("API composition package %q is missing", compositionPath)
	}

	modulesRoot := filepath.Join(internalRoot, "modules")
	contexts, err := os.ReadDir(modulesRoot)
	if err != nil {
		t.Fatalf("read context API directory: %v", err)
	}
	for _, context := range contexts {
		if !context.IsDir() {
			continue
		}
		contextPath := filepath.Join(modulesRoot, context.Name())
		entries, err := os.ReadDir(contextPath)
		if err != nil {
			t.Errorf("read context API %q: %v", context.Name(), err)
			continue
		}
		for _, entry := range entries {
			if entry.IsDir() {
				t.Errorf("implementation package remains nested under context API %q: %s", context.Name(), entry.Name())
				continue
			}
			if !strings.HasSuffix(entry.Name(), ".go") || strings.HasSuffix(entry.Name(), "_test.go") {
				continue
			}
			source, err := os.ReadFile(filepath.Join(contextPath, entry.Name()))
			if err != nil {
				t.Errorf("read context API %q file %q: %v", context.Name(), entry.Name(), err)
				continue
			}
			for _, implementationImport := range []string{
				`"database/sql"`,
				`"github.com/jackc/pgx/v5"`,
				`"github.com/jackc/pgx/v5/pgconn"`,
				`"github.com/jackc/pgx/v5/pgtype"`,
				`"github.com/jackc/pgx/v5/pgxpool"`,
				`"github.com/nooroctavian/rhasia-scret/apps/api/internal/postgres"`,
				`"github.com/labstack/echo/v5"`,
			} {
				if strings.Contains(string(source), implementationImport) {
					t.Errorf("context API %q file %q imports implementation dependency %s", context.Name(), entry.Name(), implementationImport)
				}
			}
		}
	}
}
