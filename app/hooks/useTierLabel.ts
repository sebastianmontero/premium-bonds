import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { getLocalizedTierLabel } from "@/app/lib/formatters";

export function useTierLabel() {
  const t = useTranslations("Common.tiers");

  return useCallback(
    (tierIndex: number, totalTiersCount: number = 3): string => {
      return getLocalizedTierLabel(
        tierIndex,
        (key, values) =>
          key === "tierN" && values?.tier !== undefined
            ? t("tierN", { tier: values.tier })
            : t(key as "grand" | "runnerUp" | "consolation"),
        totalTiersCount
      );
    },
    [t]
  );
}
