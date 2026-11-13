export type HttpScenario = Readonly<{
  name: string;
  method: string;
  path: string;
  expectedStatus: number;
  alias?: string;
  body?: unknown;
  headers?: Readonly<Record<string, string>>;
}>;

export type ComparedResponse = Readonly<{
  status: number;
  body: unknown;
  headers: Headers;
}>;

export type ComparedResponses = Readonly<{
  ts: ComparedResponse;
  go: ComparedResponse;
}>;

export type CompareOperation = (scenario: HttpScenario, goScenario?: HttpScenario) => Promise<ComparedResponses>;
