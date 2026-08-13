import { cleanBrowserE2eUsers, disconnectBrowserE2eDatabase } from "./e2e-database";

export default async function globalSetup(): Promise<void> {
  await cleanBrowserE2eUsers();
  await disconnectBrowserE2eDatabase();
}
