const runtimeParityDatabaseParameters = new Set(["schema"]);

export type RuntimeParityDatabaseURLs = Readonly<{
  baseURL: URL;
  containerID: string;
  go: string;
  ts: string;
}>;

export function readAndValidateDatabaseURLs(environment: NodeJS.ProcessEnv): RuntimeParityDatabaseURLs {
  const runID = environment.RHSIA_DISPOSABLE_RUN_ID ?? "";
  const containerID = environment.RHSIA_TESTCONTAINER_ID ?? "";
  const classification = environment.RHSIA_DISPOSABLE_DATA_CLASSIFICATION ?? "";
  const baseValue = environment.DATABASE_URL ?? "";
  const directValue = environment.DIRECT_URL ?? "";
  const goValue = environment.RHSIA_API_PARITY_GO_DATABASE_URL ?? "";
  const tsValue = environment.RHSIA_API_PARITY_TS_DATABASE_URL ?? "";
  if (
    !/^[0-9a-f]{16}$/.test(runID) ||
    !/^[0-9a-f]{12,64}$/.test(containerID) ||
    classification !== "synthetic" ||
    !baseValue ||
    baseValue !== directValue
  ) {
    throw new Error("Runtime parity requires the verified synthetic disposable PostgreSQL test scope.");
  }

  let baseURL: URL;
  let goURL: URL;
  let tsURL: URL;
  try {
    baseURL = new URL(baseValue);
    goURL = new URL(goValue);
    tsURL = new URL(tsValue);
  } catch {
    throw new Error("Runtime parity database URLs are invalid.");
  }
  const goName = `rhasia_scret_parity_go_${runID}`;
  const tsName = `rhasia_scret_parity_ts_${runID}`;
  const matchesBaseConnection = (candidate: URL): boolean =>
    candidate.protocol === baseURL.protocol &&
    candidate.hostname === baseURL.hostname &&
    candidate.port === baseURL.port &&
    candidate.username === baseURL.username &&
    candidate.password === baseURL.password;
  if (
    !isSafeRuntimeParityDatabaseURL(baseURL) ||
    !isSafeRuntimeParityDatabaseURL(goURL) ||
    !isSafeRuntimeParityDatabaseURL(tsURL) ||
    baseURL.username !== "rhasia_test" ||
    baseURL.password !== "rhasia_test_password" ||
    baseURL.pathname !== "/rhasia_scret_test" ||
    goURL.pathname !== `/${goName}` ||
    tsURL.pathname !== `/${tsName}` ||
    !matchesBaseConnection(goURL) ||
    !matchesBaseConnection(tsURL) ||
    !isLoopback(baseURL.hostname)
  ) {
    throw new Error("Runtime parity database URLs do not match the run-owned Testcontainer clones.");
  }
  return { baseURL, containerID, go: goURL.toString(), ts: tsURL.toString() };
}

function isSafeRuntimeParityDatabaseURL(value: URL): boolean {
  if (
    (value.protocol !== "postgres:" && value.protocol !== "postgresql:") ||
    value.hostname === "" ||
    value.hash !== ""
  ) {
    return false;
  }
  const parameters = [...value.searchParams.entries()];
  if (parameters.length > runtimeParityDatabaseParameters.size) return false;
  return parameters.every(
    ([name, parameterValue]) => runtimeParityDatabaseParameters.has(name) && parameterValue === "public",
  );
}

function isLoopback(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}
