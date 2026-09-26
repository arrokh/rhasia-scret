import type { AppLocale } from "@/i18n/config";
import contextualHelpJson from "./contextual-help-content.json";

export const CONTEXTUAL_HELP_TOPIC_IDS = [
  "personalVaultSetup",
  "personalVaultUnlock",
  "authenticatorAccountImport",
  "sharedVaultInvitations",
  "sharedVaultPermissions",
] as const;

export type ContextualHelpTopicId = (typeof CONTEXTUAL_HELP_TOPIC_IDS)[number];

export type ContextualHelpContent = Readonly<{
  title: string;
  summary: string;
  purpose: string;
  nextStep: string;
  consequences: string;
  cancelOrRecover: string;
}>;

type ContextualHelpCatalog = Readonly<
  Record<ContextualHelpTopicId, Readonly<Record<AppLocale, ContextualHelpContent>>>
>;

const contextualHelpContent: ContextualHelpCatalog = contextualHelpJson;

export function getContextualHelpContent(topic: ContextualHelpTopicId, locale: AppLocale): ContextualHelpContent {
  return contextualHelpContent[topic][locale];
}
