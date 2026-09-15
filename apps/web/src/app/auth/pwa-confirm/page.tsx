import { AppPage, Brand, SurfaceCard } from "@/shared/presentation/app-ui";
import { MagicLinkConfirmation } from "@/modules/identity/presentation/magic-link-confirmation";

export const dynamic = "force-dynamic";

export default function ConfirmPwaMagicLinkPage() {
  return (
    <AppPage centered>
      <SurfaceCard className="grid w-full max-w-md gap-6 px-5 py-7 sm:px-8 sm:py-9" aria-labelledby="page-title">
        <h1 id="page-title" className="text-center">
          <Brand />
        </h1>
        <MagicLinkConfirmation client="pwa" />
      </SurfaceCard>
    </AppPage>
  );
}
