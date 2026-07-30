import { LocalVaultPage } from "@/modules/local-vault/presentation/local-vault-page";

type LocalVaultRouteProps = { searchParams: Promise<{ from?: string | string[] }> };

export default async function LocalVaultRoute({ searchParams }: LocalVaultRouteProps) {
  const from = (await searchParams).from;
  const backHref = (Array.isArray(from) ? from[0] : from) === "landing" ? "/" : "/sign-in";
  return <LocalVaultPage backHref={backHref} />;
}
