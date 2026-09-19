import { cleanBrowserE2eUsers } from "./e2e-database";

export default async function globalTeardown(): Promise<void> {
  await cleanBrowserE2eUsers();
}
