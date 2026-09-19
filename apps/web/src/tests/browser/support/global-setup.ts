import { cleanBrowserE2eUsers } from "./e2e-database";

export default async function globalSetup(): Promise<void> {
  await cleanBrowserE2eUsers();
}
