import { useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  getLocalizedTierLabel,
  type LocalizedTierLabelOptions,
} from "@/app/lib/formatters";

export function useTierLabel() {
  const t = useTranslations("Common.tiers");

  return useCallback(
    (tierIndex: number, options?: LocalizedTierLabelOptions): string => {
      return getLocalizedTierLabel(tierIndex, (k, v) => t(k, v), options);
    },
    [t]
  );
}
