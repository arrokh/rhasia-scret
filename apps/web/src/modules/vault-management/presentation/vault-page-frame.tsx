import { Suspense, type ReactNode } from "react";
import { AppPage, PageHeader, SurfaceCard, SURFACE_CARD_CONTENT_PADDING_CLASS } from "@/shared/presentation/app-ui";
import {
  ActionLoadingPlaceholder,
  DirectoryLoadingPlaceholder,
  SectionLoadingPlaceholder,
} from "@/shared/presentation/loading-placeholder";
import { VaultPageLogoutAction } from "./vault-page-logout-action";

export function VaultPageFrame({
  backHref,
  backLabel,
  backPrefetch,
  title,
  description,
  contentLabel,
  loadingVariant = "section",
  children,
}: {
  backHref?: string;
  backLabel?: string;
  backPrefetch?: boolean;
  title: string;
  description: string;
  contentLabel: string;
  loadingVariant?: "section" | "directory";
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
            <div className={SURFACE_CARD_CONTENT_PADDING_CLASS}>
              {loadingVariant === "directory" ? (
                <DirectoryLoadingPlaceholder rows={3} />
              ) : (
                <SectionLoadingPlaceholder rows={3} />
              )}
            </div>
          }
        >
          {children}
        </Suspense>
      </SurfaceCard>
    </AppPage>
  );
}
