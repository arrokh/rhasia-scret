export function startConfigurationWizard(options?: {
  root?: string;
  host?: string;
  port?: number;
  commitSha?: string;
  tailscaleOrigin?: string | null;
}): Promise<{
  url: string;
  closed: Promise<void>;
  close: () => Promise<void>;
  readonly saved: boolean;
}>;
