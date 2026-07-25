export interface VerifiedSession {
  subject: string;
  email: string;
}

export interface SessionVerifier {
  verify(): Promise<VerifiedSession | null>;
}
