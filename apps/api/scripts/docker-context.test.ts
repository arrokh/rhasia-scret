import { describe, expect, it } from "vitest";
import { hasDockerConnectionOverride, isLocalDockerContext } from "./docker-context";

describe("disposable database Docker scope", () => {
  it.each(["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"])(
    "rejects %s so Docker CLI and Testcontainers cannot target different daemons",
    (name) => {
      expect(hasDockerConnectionOverride({ [name]: "synthetic-override" })).toBe(true);
    },
  );

  it("allows absent or empty Docker connection overrides", () => {
    expect(hasDockerConnectionOverride({})).toBe(false);
    expect(hasDockerConnectionOverride({ DOCKER_HOST: "" })).toBe(false);
  });

  it("accepts only a local Unix socket or named pipe context", () => {
    expect(isLocalDockerContext([{ Endpoints: { docker: { Host: "unix:///var/run/docker.sock" } } }])).toBe(true);
    expect(isLocalDockerContext([{ Endpoints: { docker: { Host: "tcp://docker.example.test:2376" } } }])).toBe(false);
    expect(isLocalDockerContext([{ Endpoints: { docker: { Host: "unix:////remote/docker.sock" } } }])).toBe(false);
  });
});
