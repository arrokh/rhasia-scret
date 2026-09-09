import { Suspense, type ReactNode } from "react";
import { AppPage, PageHeader, SurfaceCard } from "@/shared/presentation/app-ui";
import { ActionLoadingPlaceholder, SectionLoadingPlaceholder } from "@/shared/presentation/loading-placeholder";
import { VaultPageLogoutAction } from "./vault-page-logout-action";

export function VaultPageFrame({
  backHref,
  backLabel,
  backPrefetch,
  title,
  description,
  contentLabel,
  children,
}: {
  backHref?: string;
  backLabel?: string;
  backPrefetch?: boolean;
  title: string;
  description: string;
  contentLabel: string;
  children: ReactNode;
}) {
  return (
    <AppPage>
      <PageHeader
        backHref={backHref}
        backLabel={backLabel}
        backPrefetch={backPrefetch}
        title={title}
        description={description}
        action={
          <Suspense fallback={<ActionLoadingPlaceholder />}>
            <VaultPageLogoutAction />
          </Suspense>
        }
      />
      <SurfaceCard aria-label={contentLabel}>
        <Suspense
          fallback={
            <div className="p-5 sm:p-6">
              <SectionLoadingPlaceholder rows={3} />
            </div>
          }
        >
          {children}
        </Suspense>
      </SurfaceCard>
    </AppPage>
  );
}
