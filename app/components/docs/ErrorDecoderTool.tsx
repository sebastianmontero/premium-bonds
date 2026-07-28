"use client";

import React, { useState } from "react";
import { ERROR_LOOKUP_ITEMS, ErrorLookupItem } from "@/app/lib/docs/data";

interface ErrorDecoderToolProps {
  locale?: string;
}

export function ErrorDecoderTool({ locale = "en" }: ErrorDecoderToolProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedError, setSelectedError] = useState<ErrorLookupItem | null>(
    ERROR_LOOKUP_ITEMS[0]
  );

  const filteredErrors = ERROR_LOOKUP_ITEMS.filter((item) => {
    if (!searchTerm.trim()) return true;
    const q = searchTerm.toLowerCase();
    const code = item.code.toLowerCase();
    const name = item.name.toLowerCase();
    const summary = (item.summary[locale] || item.summary["en"]).toLowerCase();
    return code.includes(q) || name.includes(q) || summary.includes(q);
  });

  return (
    <div className="my-8 rounded-2xl bg-surface-container-low border border-outline-variant/30 p-6 shadow-xl space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="font-display text-lg font-bold text-on-surface flex items-center gap-2">
            <span>🛠️</span>
            {locale === "es"
              ? "Herramienta de Consulta de Errores Solana"
              : "Solana Self-Service Error Decoder"}
          </h3>
          <p className="text-sm text-on-surface-variant">
            {locale === "es"
              ? "Busca un código de error o firma de transacción copiada de Solscan para obtener una explicación clara."
              : "Lookup an error code or signature copied from Solscan to get a plain-English explanation."}
          </p>
        </div>
      </div>

      {/* Input Search & Filter */}
      <div className="relative">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder={
            locale === "es"
              ? "Buscar código (ej. 4001, 0x1, 0x1770, Blockhash)..."
              : "Search error code (e.g. 4001, 0x1, 0x1770, Blockhash)..."
          }
          className="w-full rounded-xl bg-surface-container-high border border-outline-variant/30 py-2.5 px-4 text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:border-primary focus:outline-none"
        />
      </div>

      {/* Common Presets Buttons */}
      <div className="flex flex-wrap gap-2">
        <span className="text-xs font-semibold text-on-surface-variant/70 flex items-center">
          {locale === "es" ? "Errores habituales:" : "Common Presets:"}
        </span>
        {ERROR_LOOKUP_ITEMS.map((item) => (
          <button
            key={item.code}
            onClick={() => {
              setSelectedError(item);
              setSearchTerm("");
            }}
            className={`rounded-lg px-2.5 py-1 text-xs font-mono transition cursor-pointer border ${
              selectedError?.code === item.code
                ? "bg-primary text-on-primary font-bold border-primary"
                : "bg-surface-container-high border-outline-variant/20 text-on-surface-variant hover:text-on-surface"
            }`}
          >
            {item.code}
          </button>
        ))}
      </div>

      {/* Selected Error Resolution Card */}
      {selectedError ? (
        <div className="rounded-xl bg-surface-container/90 border border-outline-variant/20 p-5 space-y-4 animate-fade-in">
          <div className="flex items-center justify-between gap-2 border-b border-outline-variant/15 pb-3">
            <div>
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-primary">
                Code {selectedError.code}
              </span>
              <h4 className="font-mono text-base font-bold text-on-surface mt-0.5">
                {selectedError.name}
              </h4>
            </div>
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary border border-primary/20 capitalize">
              {selectedError.category}
            </span>
          </div>

          <div className="space-y-3 text-sm">
            <div>
              <h5 className="font-semibold text-on-surface flex items-center gap-1.5 text-xs sm:text-sm text-amber-400">
                <span>⚠️</span>
                {locale === "es"
                  ? "1. Qué Sucedió (Diagnóstico)"
                  : "1. What Happened (Diagnosis)"}
              </h5>
              <p className="mt-1 text-on-surface-variant leading-relaxed pl-5">
                {selectedError.summary[locale] || selectedError.summary["en"]}
              </p>
            </div>

            <div>
              <h5 className="font-semibold text-on-surface flex items-center gap-1.5 text-xs sm:text-sm text-emerald-400">
                <span>👉</span>
                {locale === "es"
                  ? "2. Cómo Resolverlo (Paso a Paso)"
                  : "2. How to Fix It (Resolution Step)"}
              </h5>
              <p className="mt-1 text-on-surface-variant leading-relaxed pl-5 font-medium">
                {selectedError.solution[locale] || selectedError.solution["en"]}
              </p>
            </div>
          </div>
        </div>
      ) : filteredErrors.length > 0 ? (
        <div className="space-y-2">
          {filteredErrors.map((item) => (
            <button
              key={item.code}
              onClick={() => setSelectedError(item)}
              className="w-full text-left rounded-xl bg-surface-container-high p-3 text-sm hover:bg-surface-container-highest transition flex items-center justify-between border border-outline-variant/20"
            >
              <span className="font-mono font-bold text-primary">
                {item.code} - {item.name}
              </span>
              <span className="text-xs text-on-surface-variant">
                {locale === "es" ? "Ver solución →" : "View fix →"}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="p-4 text-center text-sm text-on-surface-variant">
          {locale === "es"
            ? "No se encontró ningún código coincidente."
            : "No matching error code found in index."}
        </div>
      )}
    </div>
  );
}
