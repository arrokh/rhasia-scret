import { cleanBrowserE2eUsers, disconnectBrowserE2eDatabase } from "./e2e-database";

export default async function globalTeardown(): Promise<void> {
  await cleanBrowserE2eUsers();
  await disconnectBrowserE2eDatabase();
}
