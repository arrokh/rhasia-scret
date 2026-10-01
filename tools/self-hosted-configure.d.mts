export function startConfigurationWizard(options?: {
  root?: string;
  host?: string;
  port?: number;
  commitSha?: string;
  tailscaleOrigin?: string | null;
  replaceExisting?: boolean;
}): Promise<{
  url: string;
  closed: Promise<void>;
  close: () => Promise<void>;
  readonly saved: boolean;
  readonly backupPath: string | undefined;
}>;
