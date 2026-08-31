"use client";

import React, { useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import {
  ERROR_LOOKUP_ITEMS,
  ErrorLookupItem,
  normalizeSearchText,
  SupportedLocale,
} from "@/app/lib/docs/data";

interface ErrorDecoderToolProps {
  locale?: string;
}

const FEATURED_ERROR_PRESETS = [
  "4001",
  "0x1",
  "BlockhashNotFound",
  "6000",
  "6007",
  "6020",
  "6044",
  "6047",
];

export function ErrorDecoderTool({ locale = "en" }: ErrorDecoderToolProps) {
  const searchParams = useSearchParams();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPreset, setSelectedPreset] = useState<ErrorLookupItem | null>(
    null
  );

  const targetLocale = (locale === "es" ? "es" : "en") as SupportedLocale;

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
            {locale === "es"
              ? "Herramienta de Consulta de Errores Solana & Anchor"
              : "Solana & Anchor Error Decoder Tool"}
          </h3>
          <p className="text-sm text-on-surface-variant">
            {locale === "es"
              ? "Busca un código de error decimal (6020), hexadecimal (0x1784) o nombre de error para obtener una explicación clara."
              : "Lookup an error code (6020), hex code (0x1784), or keyword to get a plain-English explanation."}
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
          placeholder={
            locale === "es"
              ? "Buscar código o palabra clave (ej. 4001, 0x1, 6044, 0x179c, Timelock)..."
              : "Search code or keyword (e.g. 4001, 0x1, 6044, 0x179c, Timelock)..."
          }
          className="w-full rounded-xl bg-surface-container-high border border-outline-variant/30 py-2.5 pl-4 pr-10 text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40 transition shadow-inner"
        />
        {searchTerm && (
          <button
            type="button"
            onClick={() => setSearchTerm("")}
            className="absolute right-3 text-xs text-on-surface-variant hover:text-on-surface cursor-pointer px-1 py-0.5 rounded bg-surface-container"
          >
            ✕
          </button>
        )}
      </div>

      {/* Common Presets Buttons */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-on-surface-variant/70">
          {locale === "es" ? "Accesos Rápidos:" : "Common Presets:"}
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
            {locale === "es"
              ? `Resultados encontrados (${filteredErrors.length})`
              : `Matching Errors (${filteredErrors.length})`}
          </div>

          {filteredErrors.length === 0 ? (
            <div className="rounded-xl bg-surface-container/60 border border-outline-variant/20 p-6 text-center text-sm text-on-surface-variant">
              {locale === "es"
                ? "No se encontró ningún código de error que coincida con tu búsqueda."
                : "No matching error codes found in index."}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 max-h-[28rem] overflow-y-auto pr-1">
              {filteredErrors.map((item) => (
                <div
                  key={item.code}
                  className="rounded-xl bg-surface-container/90 border border-outline-variant/20 p-4 space-y-2 hover:border-primary/40 transition"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-outline-variant/15 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/20">
                        Code {item.code}
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
                        {locale === "es" ? "Diagnóstico: " : "Diagnosis: "}
                      </strong>
                      {item.diagnosis[targetLocale] || item.diagnosis.en}
                    </p>
                    <p className="text-on-surface-variant">
                      <strong className="text-emerald-300">
                        {locale === "es" ? "Solución: " : "Resolution: "}
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
                  Code {activeDisplayItem.code}
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
                {locale === "es"
                  ? "1. Qué Sucedió (Diagnóstico)"
                  : "1. What Happened (Diagnosis)"}
              </h5>
              <p className="mt-1 text-on-surface-variant leading-relaxed pl-5">
                {activeDisplayItem.diagnosis[targetLocale] ||
                  activeDisplayItem.diagnosis.en}
              </p>
            </div>

            <div>
              <h5 className="font-semibold text-on-surface flex items-center gap-1.5 text-xs sm:text-sm text-emerald-300">
                <span>👉</span>
                {locale === "es"
                  ? "2. Cómo Resolverlo (Paso a Paso)"
                  : "2. How to Fix It (Step-by-Step Resolution)"}
              </h5>
              <p className="mt-1 text-on-surface-variant leading-relaxed pl-5 font-medium">
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
