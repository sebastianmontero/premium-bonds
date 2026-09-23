"use client";

import React, { useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  ERROR_LOOKUP_ITEMS,
  ErrorLookupItem,
  normalizeSearchText,
  SupportedLocale,
} from "@/app/lib/docs/data";

const FEATURED_ERROR_PRESETS = [
  "4001",
  "0x1",
  "BlockhashNotFound",
  "6000",
  "6007",
  "6020",
  "6044",
  "6047",
  "6055",
  "6058",
];

export function ErrorDecoderTool() {
  const currentLocale = useLocale();
  const targetLocale = (
    currentLocale === "es" ? "es" : "en"
  ) as SupportedLocale;
  const t = useTranslations("Docs");
  const tCommon = useTranslations("Common.aria");

  const searchParams = useSearchParams();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPreset, setSelectedPreset] = useState<ErrorLookupItem | null>(
    null
  );

  // Derive selection from URL search params (e.g. ?code=6044 or ?q=6044)
  const urlParam = searchParams.get("code") || searchParams.get("q");
  const urlSelectedError = useMemo(() => {
    if (!urlParam) return null;
    const cleanParam = normalizeSearchText(urlParam);
    return (
      ERROR_LOOKUP_ITEMS.find((item) => {
        const itemCode = normalizeSearchText(item.code);
        const itemHex = item.hexCode ? normalizeSearchText(item.hexCode) : "";
        const itemNum = item.numericCode ? String(item.numericCode) : "";
        return (
          itemCode === cleanParam ||
          itemHex === cleanParam ||
          itemHex.replace("0x", "") === cleanParam ||
          itemNum === cleanParam
        );
      }) ?? null
    );
  }, [urlParam]);

  // Dynamic filter matching decimal, hex, name, diagnosis, and solution
  const filteredErrors = useMemo(() => {
    if (!searchTerm.trim()) return [];
    const q = normalizeSearchText(searchTerm);

    return ERROR_LOOKUP_ITEMS.filter((item) => {
      const code = normalizeSearchText(item.code);
      const hex = item.hexCode ? normalizeSearchText(item.hexCode) : "";
      const hexRaw = hex.replace("0x", "");
      const numeric = item.numericCode ? String(item.numericCode) : "";
      const name = normalizeSearchText(item.name);
      const diagnosis = normalizeSearchText(
        item.diagnosis[targetLocale] || item.diagnosis.en
      );
      const solution = normalizeSearchText(
        item.solution[targetLocale] || item.solution.en
      );

      return (
        code.includes(q) ||
        hex.includes(q) ||
        hexRaw.includes(q) ||
        numeric.includes(q) ||
        name.includes(q) ||
        diagnosis.includes(q) ||
        solution.includes(q)
      );
    });
  }, [searchTerm, targetLocale]);

  const activeDisplayItem = searchTerm.trim()
    ? null
    : (selectedPreset ?? urlSelectedError ?? ERROR_LOOKUP_ITEMS[0]);

  const featuredItems = useMemo(() => {
    return FEATURED_ERROR_PRESETS.map((code) =>
      ERROR_LOOKUP_ITEMS.find((item) => item.code === code)
    ).filter((item): item is ErrorLookupItem => item !== undefined);
  }, []);

  return (
    <div className="my-8 rounded-2xl bg-surface-container-low border border-outline-variant/30 p-6 shadow-xl space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="font-display text-lg font-bold text-on-surface flex items-center gap-2">
            <span>🛠️</span>
            {t("errorDecoderTitle")}
          </h3>
          <p className="text-sm text-on-surface-variant">
            {t("errorDecoderSubtitle")}
          </p>
        </div>
      </div>

      {/* Input Search & Filter */}
      <div className="relative flex items-center">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            if (e.target.value.trim()) {
              setSelectedPreset(null);
            }
          }}
          placeholder={t("searchErrorPlaceholder")}
          className="w-full rounded-xl bg-surface-container-high border border-outline-variant/30 py-2 ps-4 pe-11 text-base md:text-sm min-h-[44px] md:min-h-[38px] text-on-surface placeholder:text-on-surface-variant/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40 transition shadow-inner"
        />
        {searchTerm && (
          <button
            type="button"
            onClick={() => setSearchTerm("")}
            className="absolute end-1 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] flex items-center justify-center text-xs text-on-surface-variant hover:text-on-surface cursor-pointer"
            aria-label={tCommon("clearSearch")}
          >
            ✕
          </button>
        )}
      </div>

      {/* Common Presets Buttons */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-on-surface-variant/70">
          {t("commonPresets")}
        </span>
        {featuredItems.map((item) => (
          <button
            key={item.code}
            onClick={() => {
              setSelectedPreset(item);
              setSearchTerm("");
            }}
            className={`rounded-lg px-2.5 py-1 text-xs font-mono transition cursor-pointer border ${
              activeDisplayItem?.code === item.code
                ? "bg-primary text-on-primary font-bold border-primary shadow-sm"
                : "bg-surface-container-high border-outline-variant/20 text-on-surface-variant hover:text-on-surface hover:border-primary/40"
            }`}
          >
            {item.code}
          </button>
        ))}
      </div>

      {/* Live Search Results List */}
      {searchTerm.trim().length > 0 && (
        <div className="space-y-3 animate-fade-in">
          <div className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant/70">
            {t("matchingErrors", { count: filteredErrors.length })}
          </div>

          {filteredErrors.length === 0 ? (
            <div className="rounded-xl bg-surface-container/60 border border-outline-variant/20 p-6 text-center text-sm text-on-surface-variant">
              {t("noMatchingErrors")}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 max-h-[28rem] overflow-y-auto pe-1">
              {filteredErrors.map((item) => (
                <div
                  key={item.code}
                  className="rounded-xl bg-surface-container/90 border border-outline-variant/20 p-4 space-y-2 hover:border-primary/40 transition"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-outline-variant/15 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/20">
                        {t("codeLabel", { code: item.code })}
                        {item.hexCode ? ` (${item.hexCode})` : ""}
                      </span>
                      <h4 className="font-mono text-sm font-bold text-on-surface">
                        {item.name}
                      </h4>
                    </div>
                    <span className="rounded-full bg-surface-container-high px-2.5 py-0.5 text-[10px] font-semibold text-on-surface-variant capitalize border border-outline-variant/20">
                      {item.category}
                    </span>
                  </div>

                  <div className="space-y-1.5 text-xs">
                    <p className="text-on-surface-variant">
                      <strong className="text-amber-300">
                        {t("diagnosisLabel")}
                      </strong>
                      {item.diagnosis[targetLocale] || item.diagnosis.en}
                    </p>
                    <p className="text-on-surface-variant">
                      <strong className="text-emerald-300">
                        {t("resolutionLabel")}
                      </strong>
                      {item.solution[targetLocale] || item.solution.en}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Selected Single Error Card (Default View / Preset Selected) */}
      {activeDisplayItem && (
        <div className="rounded-xl bg-surface-container/90 border border-outline-variant/20 p-5 space-y-4 animate-fade-in">
          <div className="flex items-center justify-between gap-2 border-b border-outline-variant/15 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-primary">
                  {t("codeLabel", { code: activeDisplayItem.code })}
                </span>
                {activeDisplayItem.hexCode && (
                  <span className="text-xs font-mono text-on-surface-variant/70">
                    ({activeDisplayItem.hexCode})
                  </span>
                )}
              </div>
              <h4 className="font-mono text-base font-bold text-on-surface mt-0.5">
                {activeDisplayItem.name}
              </h4>
            </div>
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary border border-primary/20 capitalize">
              {activeDisplayItem.category}
            </span>
          </div>

          <div className="space-y-3 text-sm">
            <div>
              <h5 className="font-semibold text-on-surface flex items-center gap-1.5 text-xs sm:text-sm text-amber-300">
                <span>⚠️</span>
                {t("stepDiagnosis")}
              </h5>
              <p className="mt-1 text-on-surface-variant leading-relaxed ps-5">
                {activeDisplayItem.diagnosis[targetLocale] ||
                  activeDisplayItem.diagnosis.en}
              </p>
            </div>

            <div>
              <h5 className="font-semibold text-on-surface flex items-center gap-1.5 text-xs sm:text-sm text-emerald-300">
                <span>👉</span>
                {t("stepResolution")}
              </h5>
              <p className="mt-1 text-on-surface-variant leading-relaxed ps-5 font-medium">
                {activeDisplayItem.solution[targetLocale] ||
                  activeDisplayItem.solution.en}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
