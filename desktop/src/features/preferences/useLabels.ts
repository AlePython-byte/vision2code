import { useTranslation } from "react-i18next";
import { i18n } from "./i18n.ts";
import { messageKeys } from "./resources.ts";
export function useLabels() {
  const { t } = useTranslation(undefined, { i18n });
  return { t, message: (value: string) => value ? t(messageKeys[value] ?? "analysisFailure") : "" };
}
