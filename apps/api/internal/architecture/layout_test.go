package architecture

import (
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestImplementationPackagesUseFlatLayerRoots(t *testing.T) {
	_, sourcePath, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("locate API architecture test source")
	}
	apiRoot := filepath.Clean(filepath.Join(filepath.Dir(sourcePath), "../.."))
	internalRoot := filepath.Join(apiRoot, "internal")

	for _, layer := range []string{"entity", "handler", "repository", "service"} {
		layerPath := filepath.Join(internalRoot, layer)
		entries, err := os.ReadDir(layerPath)
		if err != nil {
			t.Errorf("read horizontal API layer %q: %v", layer, err)
			continue
		}
		goFiles := 0
		for _, entry := range entries {
			if entry.IsDir() {
				t.Errorf("implementation package is nested under flat API layer %q: %s", layer, entry.Name())
				continue
			}
			if !strings.HasSuffix(entry.Name(), ".go") || strings.HasSuffix(entry.Name(), "_test.go") {
				continue
			}
			goFiles++
			filePath := filepath.Join(layerPath, entry.Name())
			file, err := parser.ParseFile(token.NewFileSet(), filePath, nil, parser.PackageClauseOnly)
			if err != nil {
				t.Errorf("parse package declaration in %q: %v", filePath, err)
				continue
			}
			if file.Name.Name != layer {
				t.Errorf("flat API layer %q file %q declares package %q", layer, entry.Name(), file.Name.Name)
			}
		}
		if goFiles == 0 {
			t.Errorf("flat API layer %q has no implementation files", layer)
		}
	}

	for _, removedLayer := range []string{"adapter", "modules"} {
		if _, err := os.Stat(filepath.Join(internalRoot, removedLayer)); !os.IsNotExist(err) {
			t.Errorf("obsolete API layer %q remains under internal", removedLayer)
		}
	}

	compositionPath := filepath.Join(internalRoot, "app", "api")
	if info, err := os.Stat(compositionPath); err != nil || !info.IsDir() {
		t.Errorf("API composition package %q is missing", compositionPath)
	}
}
