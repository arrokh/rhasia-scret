export function hasDockerConnectionOverride(environment: NodeJS.ProcessEnv): boolean {
  return ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"].some(
    (name) => environment[name] !== undefined && environment[name] !== "",
  );
}

export function isLocalDockerContext(contexts: unknown): boolean {
  if (!Array.isArray(contexts) || contexts.length !== 1) return false;
  const endpoints = contexts[0]?.Endpoints;
  const host = endpoints?.docker?.Host;
  if (typeof host !== "string") return false;
  if (host.startsWith("unix:///")) {
    try {
      const parsed = new URL(host);
      return (
        parsed.protocol === "unix:" &&
        parsed.hostname === "" &&
        parsed.pathname.startsWith("/") &&
        !parsed.pathname.startsWith("//") &&
        !parsed.pathname.split("/").includes("..") &&
        !parsed.search &&
        !parsed.hash
      );
    } catch {
      return false;
    }
  }
  const namedPipePrefix = "npipe:////./pipe/";
  return host.startsWith(namedPipePrefix) && /^[a-z0-9_.-]+$/iu.test(host.slice(namedPipePrefix.length));
}
