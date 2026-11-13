package httpapi

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"
	"testing"

	"github.com/labstack/echo/v5"
)

type routeManifestEntry struct {
	Method string `json:"method"`
	Route  string `json:"route"`
}

type recordedRoute struct {
	method string
	path   string
}

type routeRecorder struct {
	routes []recordedRoute
}

func (recorder *routeRecorder) add(method string, path string) echo.RouteInfo {
	recorder.routes = append(recorder.routes, recordedRoute{method: method, path: path})
	return echo.RouteInfo{}
}

func (recorder *routeRecorder) CONNECT(path string, _ echo.HandlerFunc, _ ...echo.MiddlewareFunc) echo.RouteInfo {
	return recorder.add("CONNECT", path)
}
func (recorder *routeRecorder) DELETE(path string, _ echo.HandlerFunc, _ ...echo.MiddlewareFunc) echo.RouteInfo {
	return recorder.add("DELETE", path)
}
func (recorder *routeRecorder) GET(path string, _ echo.HandlerFunc, _ ...echo.MiddlewareFunc) echo.RouteInfo {
	return recorder.add("GET", path)
}
func (recorder *routeRecorder) HEAD(path string, _ echo.HandlerFunc, _ ...echo.MiddlewareFunc) echo.RouteInfo {
	return recorder.add("HEAD", path)
}
func (recorder *routeRecorder) OPTIONS(path string, _ echo.HandlerFunc, _ ...echo.MiddlewareFunc) echo.RouteInfo {
	return recorder.add("OPTIONS", path)
}
func (recorder *routeRecorder) PATCH(path string, _ echo.HandlerFunc, _ ...echo.MiddlewareFunc) echo.RouteInfo {
	return recorder.add("PATCH", path)
}
func (recorder *routeRecorder) POST(path string, _ echo.HandlerFunc, _ ...echo.MiddlewareFunc) echo.RouteInfo {
	return recorder.add("POST", path)
}
func (recorder *routeRecorder) PUT(path string, _ echo.HandlerFunc, _ ...echo.MiddlewareFunc) echo.RouteInfo {
	return recorder.add("PUT", path)
}
func (recorder *routeRecorder) TRACE(path string, _ echo.HandlerFunc, _ ...echo.MiddlewareFunc) echo.RouteInfo {
	return recorder.add("TRACE", path)
}

func TestGeneratedServerInterfaceCoversTheSeventyOperationContract(t *testing.T) {
	t.Parallel()

	serverInterface := reflect.TypeOf((*ServerInterface)(nil)).Elem()
	if got, want := serverInterface.NumMethod(), 70; got != want {
		t.Fatalf("generated ServerInterface has %d operations; want %d", got, want)
	}
}

func TestGeneratedHeadRoutesMatchOpenAPIHeadContract(t *testing.T) {
	t.Parallel()

	router := &routeRecorder{}
	RegisterHeadHandlersWithBaseURL(router, nil, "/v1")
	got := make([]string, 0, len(router.routes))
	for _, route := range router.routes {
		got = append(got, route.method+" "+route.path)
	}
	sort.Strings(got)
	want := []string{
		"HEAD /v1/health",
		"HEAD /v1/internal/retention-purge",
		"HEAD /v1/me",
		"HEAD /v1/me/deletion/preview",
		"HEAD /v1/passkey-recovery/status",
		"HEAD /v1/personal-vault",
		"HEAD /v1/personal-vault/destructive-reset",
		"HEAD /v1/secure-share-links",
		"HEAD /v1/shared-vaults",
		"HEAD /v1/shared-vaults/:vaultId",
		"HEAD /v1/shared-vaults/:vaultId/audit-events",
		"HEAD /v1/shared-vaults/:vaultId/member-permissions",
		"HEAD /v1/shared-vaults/:vaultId/participants",
		"HEAD /v1/shared-vaults/:vaultId/rotation",
		"HEAD /v1/sync/offline-bundle",
		"HEAD /v1/sync/workspace-bundle",
		"HEAD /v1/time",
		"HEAD /v1/user-crypto-profile",
		"HEAD /v1/user-encryption-identity/rotation",
		"HEAD /v1/vaults/:vaultId/accounts",
		"HEAD /v1/vaults/:vaultId/audit-events",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("generated HEAD routes=%v; want OpenAPI-declared routes %v", got, want)
	}
}

func TestGeneratedEchoRoutesMatchTheFrozenRouteManifest(t *testing.T) {
	t.Parallel()

	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("could not locate generated route test source")
	}
	repositoryRoot := filepath.Clean(filepath.Join(filepath.Dir(sourceFile), "../../../.."))
	fixturePath := filepath.Join(repositoryRoot, "packages", "api-contract", "test-fixtures", "route-manifest.json")
	fixtureBytes, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read frozen route manifest: %v", err)
	}

	var manifest []routeManifestEntry
	if err := json.Unmarshal(fixtureBytes, &manifest); err != nil {
		t.Fatalf("decode frozen route manifest: %v", err)
	}
	if len(manifest) != 70 {
		t.Fatalf("frozen route manifest has %d operations; want 70", len(manifest))
	}

	router := &routeRecorder{}
	RegisterHandlersWithBaseURL(router, nil, "/v1")
	generated := make(map[string]struct{}, len(manifest))
	for _, route := range router.routes {
		generated[route.method+" "+route.path] = struct{}{}
	}

	if len(generated) != len(manifest) {
		t.Fatalf("generated Echo router has %d operations; want %d", len(generated), len(manifest))
	}
	for _, entry := range manifest {
		key := entry.Method + " /v1" + entry.Route
		if _, ok := generated[key]; !ok {
			t.Errorf("generated Echo router is missing %s", key)
		}
	}
}
