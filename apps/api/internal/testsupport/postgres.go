package testsupport

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/postgres"
)

const (
	testDatabaseName = "rhasia_scret_test"
	testDatabaseUser = "rhasia_test"
	testDatabasePass = "rhasia_test_password"
)

var disposableRunIDPattern = regexp.MustCompile(`^[0-9a-f]{16}$`)
var dockerContainerIDPattern = regexp.MustCompile(`^[0-9a-f]{12,64}$`)

type dockerPortBinding struct {
	HostIP   string `json:"HostIp"`
	HostPort string `json:"HostPort"`
}

type dockerContainerInspection struct {
	Config struct {
		Image  string            `json:"Image"`
		Env    []string          `json:"Env"`
		Labels map[string]string `json:"Labels"`
	} `json:"Config"`
	State struct {
		Running bool   `json:"Running"`
		Status  string `json:"Status"`
	} `json:"State"`
	NetworkSettings struct {
		Ports    map[string][]dockerPortBinding `json:"Ports"`
		Networks map[string]struct{}            `json:"Networks"`
	} `json:"NetworkSettings"`
	Mounts []struct {
		Type        string `json:"Type"`
		Name        string `json:"Name"`
		Destination string `json:"Destination"`
	} `json:"Mounts"`
}

type dockerVolumeInspection struct {
	Name   string            `json:"Name"`
	Driver string            `json:"Driver"`
	Labels map[string]string `json:"Labels"`
}

type dockerNetworkInspection struct {
	Name   string            `json:"Name"`
	Driver string            `json:"Driver"`
	Scope  string            `json:"Scope"`
	Labels map[string]string `json:"Labels"`
}

func NewDisposablePostgresPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("RHSIA_GO_INTEGRATION_DATABASE_URL")
	if dsn == "" {
		t.Skip("requires explicitly configured run-owned disposable PostgreSQL 16 test stack")
	}
	validateDatabaseScope(t, dsn)

	configuration, err := postgres.ParseRuntimePoolConfig(dsn)
	if err != nil {
		t.Fatal("parse disposable Go integration database URL")
	}
	pool, err := pgxpool.NewWithConfig(context.Background(), configuration)
	if err != nil {
		t.Fatal("open disposable Go integration database pool")
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Fatal("connect to disposable Go integration database")
	}
	var version int
	if err := pool.QueryRow(context.Background(), `SELECT current_setting('server_version_num')::integer`).Scan(&version); err != nil {
		pool.Close()
		t.Fatalf("read disposable PostgreSQL version: %v", err)
	}
	if version < 160000 || version >= 170000 {
		pool.Close()
		t.Fatalf("Go integration database must be PostgreSQL 16 (server_version_num=%d)", version)
	}
	t.Cleanup(pool.Close)
	return pool
}

func validateDatabaseScope(t *testing.T, dsn string) {
	t.Helper()
	runID := os.Getenv("RHSIA_DISPOSABLE_RUN_ID")
	if !disposableRunIDPattern.MatchString(runID) || os.Getenv("RHSIA_DISPOSABLE_DATA_CLASSIFICATION") != "synthetic" {
		t.Fatal("Go integration tests require a verified synthetic disposable run ID")
	}
	if os.Getenv("DATABASE_URL") != dsn {
		t.Fatal("Go integration database runtime URL does not match the test database URL")
	}

	runtimeURL, err := url.Parse(os.Getenv("DATABASE_URL"))
	if err != nil {
		t.Fatal("runtime database URL is invalid")
	}
	directURL, err := url.Parse(os.Getenv("DIRECT_URL"))
	if err != nil || !sameDatabase(runtimeURL, directURL) {
		t.Fatal("runtime and direct database URLs do not resolve to the same disposable database")
	}
	if runtimeURL.Hostname() != "127.0.0.1" && runtimeURL.Hostname() != "localhost" {
		t.Fatal("Go integration database must be published on loopback")
	}
	if runtimeURL.Path != "/"+testDatabaseName || runtimeURL.User == nil {
		t.Fatal("Go integration database must use the synthetic test database")
	}
	password, passwordSet := runtimeURL.User.Password()
	if runtimeURL.User.Username() != testDatabaseUser || !passwordSet || password != testDatabasePass {
		t.Fatal("Go integration database must use synthetic test credentials")
	}

	containerID := os.Getenv("RHSIA_TESTCONTAINER_ID")
	if containerID != "" {
		if os.Getenv("COMPOSE_PROJECT_NAME") != "" {
			t.Fatal("Testcontainer runs must not inherit Compose database scope")
		}
		verifyTestcontainer(t, containerID, runtimeURL)
		return
	}
	if os.Getenv("CI") == "true" {
		verifyGitHubActionsDatabase(t, runID, runtimeURL, directURL)
		return
	}
	verifyDisposableComposeDatabase(t, runID, dsn, runtimeURL, directURL)
}

func sameDatabase(first, second *url.URL) bool {
	if second == nil || first == nil || first.Hostname() != second.Hostname() || first.Port() != second.Port() || first.Path != second.Path {
		return false
	}
	if first.User == nil || second.User == nil || first.User.Username() != second.User.Username() {
		return false
	}
	firstPassword, firstHasPassword := first.User.Password()
	secondPassword, secondHasPassword := second.User.Password()
	return firstHasPassword == secondHasPassword && firstPassword == secondPassword
}

func verifyDisposableComposeDatabase(t *testing.T, runID, dsn string, runtimeURL, directURL *url.URL) {
	t.Helper()
	projectName := "rhasia-scret-test-" + runID
	if os.Getenv("COMPOSE_PROJECT_NAME") != projectName || dsn != os.Getenv("DIRECT_URL") || !sameDatabase(runtimeURL, directURL) {
		t.Fatal("Go integration database URLs do not match the run-owned Compose project")
	}
	if !isLoopback(runtimeURL.Hostname()) || !isLoopback(directURL.Hostname()) {
		t.Fatal("Go integration database URLs must use local loopback")
	}

	listing := dockerOutput(t, "ps", "--all", "--filter", "label=com.docker.compose.project="+projectName,
		"--filter", "label=com.docker.compose.service=db", "--format", "{{.ID}}")
	containerIDs := strings.Fields(string(listing))
	if len(containerIDs) != 1 || !dockerContainerIDPattern.MatchString(containerIDs[0]) {
		t.Fatal("Go integration database must have exactly one inspected run-owned Compose container")
	}
	container := inspectDockerContainer(t, containerIDs[0])
	labels := container.Config.Labels
	if container.State.Status != "running" || labels["com.docker.compose.project"] != projectName || labels["com.docker.compose.service"] != "db" ||
		!strings.HasPrefix(container.Config.Image, "postgres:16") || !isRepositoryComposeProject(labels["com.docker.compose.project.working_dir"]) {
		t.Fatal("Go integration database is not the expected repository-owned PostgreSQL 16 Compose service")
	}
	verifySyntheticPostgresEnvironment(t, container.Config.Env)

	if len(container.Mounts) != 1 || container.Mounts[0].Type != "volume" ||
		container.Mounts[0].Destination != "/var/lib/postgresql/data" || !strings.HasPrefix(container.Mounts[0].Name, projectName+"_") {
		t.Fatal("Go integration database must use one project-owned PostgreSQL data volume")
	}
	volumeOutput := dockerOutput(t, "volume", "inspect", container.Mounts[0].Name)
	var volumes []dockerVolumeInspection
	if err := json.Unmarshal(volumeOutput, &volumes); err != nil || len(volumes) != 1 || volumes[0].Name != container.Mounts[0].Name ||
		volumes[0].Driver != "local" || volumes[0].Labels["com.docker.compose.project"] != projectName {
		t.Fatal("Go integration database volume is not owned by the run-scoped Compose project")
	}

	bindings := container.NetworkSettings.Ports["5432/tcp"]
	if len(bindings) == 0 {
		t.Fatal("Go integration database port has no verified loopback binding")
	}
	mappedPortFound := false
	for _, binding := range bindings {
		if !isLoopback(binding.HostIP) {
			t.Fatal("Go integration database must bind only to loopback")
		}
		if binding.HostPort == runtimeURL.Port() {
			mappedPortFound = true
		}
	}
	if !mappedPortFound {
		t.Fatal("Go integration database URL port does not map to its Compose container")
	}

	if len(container.NetworkSettings.Networks) == 0 {
		t.Fatal("Go integration database must be attached to an inspected run-owned network")
	}
	for name := range container.NetworkSettings.Networks {
		networkOutput := dockerOutput(t, "network", "inspect", name)
		var networks []dockerNetworkInspection
		if err := json.Unmarshal(networkOutput, &networks); err != nil || len(networks) != 1 || networks[0].Name != name ||
			networks[0].Driver != "bridge" || networks[0].Scope != "local" || networks[0].Labels["com.docker.compose.project"] != projectName {
			t.Fatal("Go integration database is attached to a network outside its run-scoped Compose project")
		}
	}
}

func isLoopback(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	address := net.ParseIP(host)
	return address != nil && address.IsLoopback()
}

func dockerOutput(t *testing.T, arguments ...string) []byte {
	t.Helper()
	output, err := exec.Command("docker", arguments...).Output()
	if err != nil {
		t.Fatal("cannot inspect run-owned disposable PostgreSQL resources")
	}
	return output
}

func inspectDockerContainer(t *testing.T, containerID string) dockerContainerInspection {
	t.Helper()
	output := dockerOutput(t, "inspect", containerID)
	var inspected []dockerContainerInspection
	if err := json.Unmarshal(output, &inspected); err != nil || len(inspected) != 1 {
		t.Fatal("run-owned PostgreSQL container inspection is invalid")
	}
	return inspected[0]
}

func isRepositoryComposeProject(workingDirectory string) bool {
	if strings.TrimSpace(workingDirectory) == "" {
		return false
	}
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		return false
	}
	repositoryRoot := filepath.Clean(filepath.Join(filepath.Dir(sourceFile), "../../../.."))
	repositoryRoot, err := filepath.EvalSymlinks(repositoryRoot)
	if err != nil {
		return false
	}
	workingDirectory, err = filepath.EvalSymlinks(workingDirectory)
	return err == nil && filepath.Clean(workingDirectory) == filepath.Clean(repositoryRoot)
}

func verifySyntheticPostgresEnvironment(t *testing.T, entries []string) {
	t.Helper()
	values := make(map[string]string, len(entries))
	for _, entry := range entries {
		name, value, ok := strings.Cut(entry, "=")
		if ok {
			values[name] = value
		}
	}
	if values["POSTGRES_DB"] != testDatabaseName || values["POSTGRES_USER"] != testDatabaseUser || values["POSTGRES_PASSWORD"] != testDatabasePass {
		t.Fatal("PostgreSQL container does not use the expected synthetic test configuration")
	}
}

func verifyGitHubActionsDatabase(t *testing.T, runID string, runtimeURL, directURL *url.URL) {
	t.Helper()
	if os.Getenv("GITHUB_ACTIONS") != "true" || strings.TrimSpace(os.Getenv("GITHUB_RUN_ID")) == "" ||
		strings.TrimSpace(os.Getenv("GITHUB_JOB")) == "" {
		t.Fatal("CI database tests require a job-owned GitHub Actions PostgreSQL service")
	}
	if runtimeURL.Port() != "5432" || !sameDatabase(runtimeURL, directURL) || os.Getenv("DATABASE_URL") != os.Getenv("DIRECT_URL") {
		t.Fatal("CI database URLs do not match the job-owned PostgreSQL service")
	}
	if runID != fmt.Sprintf("%016x", parseGitHubRunID(t)) {
		t.Fatal("CI disposable run marker does not match this GitHub Actions run")
	}
}

func parseGitHubRunID(t *testing.T) uint64 {
	t.Helper()
	runID, err := strconv.ParseUint(os.Getenv("GITHUB_RUN_ID"), 10, 64)
	if err != nil {
		t.Fatal("GitHub Actions run ID is invalid")
	}
	return runID
}

func verifyTestcontainer(t *testing.T, containerID string, databaseURL *url.URL) {
	t.Helper()
	if !dockerContainerIDPattern.MatchString(containerID) {
		t.Fatal("run-owned PostgreSQL Testcontainer ID is invalid")
	}
	container := inspectDockerContainer(t, containerID)
	if !container.State.Running || container.Config.Image != "postgres:16-alpine" ||
		container.Config.Labels["org.testcontainers"] != "true" || container.Config.Labels["org.testcontainers.lang"] != "node" {
		t.Fatal("Go integration database is not the expected run-owned PostgreSQL Testcontainer")
	}
	verifySyntheticPostgresEnvironment(t, container.Config.Env)
	port := databaseURL.Port()
	if port == "" {
		port = "5432"
	}
	bindings := container.NetworkSettings.Ports["5432/tcp"]
	mappedPortFound := false
	for _, binding := range bindings {
		if binding.HostPort != port {
			continue
		}
		mappedPortFound = true
		if !isLoopback(binding.HostIP) {
			t.Fatal("Go integration Testcontainer must bind only to loopback")
		}
	}
	if !mappedPortFound {
		t.Fatal("Go integration database port does not map to the run-owned PostgreSQL Testcontainer")
	}
	if len(container.Mounts) != 1 || container.Mounts[0].Type != "volume" ||
		container.Mounts[0].Destination != "/var/lib/postgresql/data" {
		t.Fatal("PostgreSQL Testcontainer must use only its disposable data volume")
	}
}

func CreateSyntheticApplicationUser(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	userID, err := NewSyntheticCUID()
	if err != nil {
		t.Fatalf("generate synthetic application user ID: %v", err)
	}
	email := fmt.Sprintf("integration-%s@example.test", userID)
	now := time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO application_users (id, email, status, created_at, updated_at)
		VALUES ($1, $2, 'ACTIVE', $3, $3)`, userID, email, now); err != nil {
		t.Fatalf("insert synthetic application user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM application_users WHERE id = $1`, userID)
	})
	return userID
}

func NewSyntheticCUID() (string, error) {
	var value [12]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	return "c" + hex.EncodeToString(value[:]), nil
}
