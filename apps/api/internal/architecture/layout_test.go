package architecture

import (
	"encoding/json"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
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

func TestProductionAPIRuntimesUseGoEntrypoints(t *testing.T) {
	_, sourcePath, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("locate API architecture test source")
	}
	apiRoot := filepath.Clean(filepath.Join(filepath.Dir(sourcePath), "../.."))

	dockerfile, err := os.ReadFile(filepath.Join(apiRoot, "Dockerfile"))
	if err != nil {
		t.Fatalf("read API Dockerfile: %v", err)
	}
	dockerfileText := string(dockerfile)
	for _, required := range []string{"go build", "ENV RHSIA_RUNTIME_ENV=production", `ENTRYPOINT ["/usr/local/bin/api"]`} {
		if !strings.Contains(dockerfileText, required) {
			t.Errorf("API Dockerfile is missing Go runtime declaration %q", required)
		}
	}
	lowerDockerfileText := strings.ToLower(dockerfileText)
	for _, forbidden := range []string{"npm install", "bun run", "env node_env="} {
		if strings.Contains(lowerDockerfileText, forbidden) {
			t.Errorf("API Dockerfile contains Node/Bun runtime declaration %q", forbidden)
		}
	}
	nodeRuntimeImage := regexp.MustCompile(`(?m)^from\s+(--platform=\S+\s+)?(node(js)?|oven/bun)(:|\s|$)`)
	if nodeRuntimeImage.MatchString(lowerDockerfileText) {
		t.Error("API Dockerfile declares a Node/Bun base image")
	}

	vercelConfig, err := os.ReadFile(filepath.Join(apiRoot, "vercel.json"))
	if err != nil {
		t.Fatalf("read API Vercel configuration: %v", err)
	}
	var vercel struct {
		IgnoreCommand   string                     `json:"ignoreCommand"`
		InstallCommand  string                     `json:"installCommand"`
		BuildCommand    json.RawMessage            `json:"buildCommand"`
		OutputDirectory json.RawMessage            `json:"outputDirectory"`
		Functions       map[string]json.RawMessage `json:"functions"`
	}
	if err := json.Unmarshal(vercelConfig, &vercel); err != nil {
		t.Fatalf("parse API Vercel configuration: %v", err)
	}
	if vercel.InstallCommand != "true" || len(vercel.BuildCommand) != 0 || len(vercel.OutputDirectory) != 0 {
		t.Errorf("Vercel API must use Go functions without a static build or output directory: install=%q build=%s output=%s", vercel.InstallCommand, vercel.BuildCommand, vercel.OutputDirectory)
	}
	if vercel.IgnoreCommand != "node ../../tools/vercel-ignore.mjs api" {
		t.Errorf("Vercel API ignore command changed unexpectedly: %q", vercel.IgnoreCommand)
	}
	if len(vercel.Functions) == 0 {
		t.Fatal("Vercel API configuration has no Go functions")
	}
	for source := range vercel.Functions {
		if filepath.Ext(source) != ".go" {
			t.Errorf("Vercel API function %q is not Go", source)
		}
	}

	apiFunctions := filepath.Join(apiRoot, "api")
	if err := filepath.WalkDir(apiFunctions, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		if filepath.Ext(path) != ".go" {
			t.Errorf("non-Go file in Vercel API function tree: %s", path)
		}
		return nil
	}); err != nil {
		t.Fatalf("inspect Vercel API function tree: %v", err)
	}

	manifestBytes, err := os.ReadFile(filepath.Join(apiRoot, "package.json"))
	if err != nil {
		t.Fatalf("read API tooling package manifest: %v", err)
	}
	var manifest struct {
		Name            string            `json:"name"`
		Dependencies    map[string]string `json:"dependencies"`
		DevDependencies map[string]string `json:"devDependencies"`
	}
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		t.Fatalf("parse API tooling package manifest: %v", err)
	}
	if manifest.Name != "@rhasia-scret/api-test-tools" || len(manifest.Dependencies) != 0 || len(manifest.DevDependencies) == 0 {
		t.Errorf("API Node package must be tooling-only: name=%q runtimeDependencies=%d developmentDependencies=%d", manifest.Name, len(manifest.Dependencies), len(manifest.DevDependencies))
	}
}
