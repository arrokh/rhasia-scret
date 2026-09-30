import assert from "node:assert/strict";
import test from "node:test";
import { isLocalDockerContext, validateDisposableDatabaseScope } from "./confirm-database-operation.mjs";

const runId = "651c40756797";
const projectName = `rhasia-load-${runId}`;
const environment = {
  COMPOSE_PROJECT_NAME: projectName,
  RHSIA_DISPOSABLE_RUN_ID: runId,
  RHSIA_DISPOSABLE_DATA_CLASSIFICATION: "synthetic",
  DATABASE_URL: "postgresql://rhasia:test@127.0.0.1:55432/synthetic_test?schema=public",
  DIRECT_URL: "postgresql://rhasia:test@127.0.0.1:55432/synthetic_test?schema=public",
};

const volume = {
  Name: `${projectName}_postgres-data`,
  Driver: "local",
  Labels: { "com.docker.compose.project": projectName },
};

const container = {
  State: { Status: "running" },
  Config: {
    Image: "postgres:16-alpine",
    Labels: {
      "com.docker.compose.project": projectName,
      "com.docker.compose.service": "db",
      "com.docker.compose.project.working_dir": process.cwd(),
    },
    Env: ["POSTGRES_USER=rhasia", "POSTGRES_PASSWORD=test", "POSTGRES_DB=synthetic_test"],
  },
  NetworkSettings: {
    Ports: {
      "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "55432" }],
    },
  },
  Mounts: [
    {
      Type: "volume",
      Name: `${projectName}_postgres-data`,
      Destination: "/var/lib/postgresql/data",
    },
  ],
};

function validate(overrides = {}) {
  return validateDisposableDatabaseScope({
    runId,
    operation: "test:migrate",
    environment,
    container,
    volume,
    ...overrides,
  });
}

test("accepts local Unix-socket and Windows named-pipe Docker contexts but rejects remote endpoints", () => {
  assert.equal(isLocalDockerContext([{ Endpoints: { docker: { Host: "unix:///var/run/docker.sock" } } }]), true);
  assert.equal(
    isLocalDockerContext([{ Endpoints: { docker: { Host: "unix://docker.example.test/docker.sock" } } }]),
    false,
  );
  assert.equal(isLocalDockerContext([{ Endpoints: { docker: { Host: "npipe:////./pipe/docker_engine" } } }]), true);
  assert.equal(
    isLocalDockerContext([{ Endpoints: { docker: { Host: "npipe:////remote-host/pipe/docker_engine" } } }]),
    false,
  );
  assert.equal(isLocalDockerContext([{ Endpoints: { docker: { Host: "ssh://docker.example.test" } } }]), false);
  assert.equal(isLocalDockerContext([]), false);
});

test("accepts a run-owned PostgreSQL database with synthetic fixtures and loopback-only access", () => {
  assert.deepEqual(validate(), []);
});

test("rejects malformed or mismatched run IDs and project names", () => {
  assert.ok(validate({ runId: "short" }).some((error) => error.includes("Run ID")));
  assert.ok(
    validate({ environment: { ...environment, COMPOSE_PROJECT_NAME: "rhasia-scret-dev" } }).some((error) =>
      error.includes("project name"),
    ),
  );
  assert.ok(
    validate({ environment: { ...environment, RHSIA_DISPOSABLE_RUN_ID: "different" } }).some((error) =>
      error.includes("run ID environment marker"),
    ),
  );
});

test("requires a synthetic data declaration and test-only operation label", () => {
  assert.ok(
    validate({
      environment: { ...environment, RHSIA_DISPOSABLE_DATA_CLASSIFICATION: "production" },
    }).some((error) => error.includes("classified as synthetic")),
  );
  assert.ok(validate({ operation: "production:migrate" }).some((error) => error.includes("test:")));
});

test("rejects hosted database URLs and mismatched local ports", () => {
  assert.ok(
    validate({ environment: { ...environment, DATABASE_URL: "postgresql://user:pass@db.example.test/vault" } }).some(
      (error) => error.includes("local PostgreSQL"),
    ),
  );
  assert.ok(
    validate({
      environment: {
        ...environment,
        DIRECT_URL: "postgresql://rhasia:test@127.0.0.1:55433/synthetic_test",
      },
    }).some((error) => error.includes("port does not map")),
  );
  assert.ok(
    validate({
      environment: {
        ...environment,
        DATABASE_URL: "postgresql://rhasia:test@127.0.0.1:55432/synthetic_test?schema=public&host=staging.example.test",
      },
    }).some((error) => error.includes("local PostgreSQL")),
  );
});

test("rejects a container outside the run-owned project or not running PostgreSQL", () => {
  assert.ok(validate({ container: undefined }).some((error) => error.includes("container is required")));
  assert.ok(
    validate({ container: { ...container, State: { Status: "exited" } } }).some((error) =>
      error.includes("not running"),
    ),
  );
  assert.ok(
    validate({
      container: {
        ...container,
        Config: {
          ...container.Config,
          Labels: { ...container.Config.Labels, "com.docker.compose.project": "rhasia-scret-dev" },
        },
      },
    }).some((error) => error.includes("does not belong")),
  );
});

test("rejects external binds, non-loopback publishing, and unrelated Compose directories", () => {
  assert.ok(
    validate({
      container: {
        ...container,
        Mounts: [{ Type: "bind", Name: "", Destination: "/var/lib/postgresql/data" }],
      },
    }).some((error) => error.includes("local volume owned by this Compose project")),
  );
  assert.ok(
    validate({
      volume: {
        ...volume,
        Labels: { "com.docker.compose.project": "rhasia-scret-dev" },
      },
    }).some((error) => error.includes("local volume owned by this Compose project")),
  );
  assert.ok(
    validate({
      container: {
        ...container,
        NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "0.0.0.0", HostPort: "55432" }] } },
      },
    }).some((error) => error.includes("loopback interface")),
  );
  assert.ok(
    validate({
      container: {
        ...container,
        Config: {
          ...container.Config,
          Labels: { ...container.Config.Labels, "com.docker.compose.project.working_dir": "/tmp/other" },
        },
      },
    }).some((error) => error.includes("created from this repository")),
  );
});

test("does not disclose or accept database credentials that do not match the isolated container", () => {
  const errors = validate({
    environment: {
      ...environment,
      DATABASE_URL: "postgresql://rhasia:wrong@127.0.0.1:55432/synthetic_test",
    },
  });
  assert.ok(errors.some((error) => error.includes("credentials or database")));
  assert.ok(errors.every((error) => !error.includes("wrong")));
});
