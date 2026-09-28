"use client";

import { lazy, Suspense, useSyncExternalStore } from "react";
import { FormLoadingPlaceholder } from "@/shared/presentation/loading-placeholder";
import type { PersonalVaultSetupFormProps } from "./personal-vault-setup-form";

const subscribeToHydration = () => () => undefined;
const getClientHydrationSnapshot = () => true;
const getServerHydrationSnapshot = () => false;
const PersonalVaultSetupForm = lazy(() =>
  import("./personal-vault-setup-form").then((module) => ({ default: module.PersonalVaultSetupForm })),
);

export function PersonalVaultSetupFormBoundary(props: PersonalVaultSetupFormProps) {
  const hydrated = useSyncExternalStore(subscribeToHydration, getClientHydrationSnapshot, getServerHydrationSnapshot);
  if (!hydrated) return <FormLoadingPlaceholder fields={5} />;
  return (
    <Suspense fallback={<FormLoadingPlaceholder fields={5} />}>
      <PersonalVaultSetupForm {...props} />
    </Suspense>
  );
}
