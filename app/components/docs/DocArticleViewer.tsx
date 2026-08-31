"use client";

import React from "react";
import { DocArticle, DOC_ARTICLES } from "@/app/lib/docs/data";
import { Link } from "@/i18n/routing";
import { ErrorDecoderTool } from "./ErrorDecoderTool";

interface DocArticleViewerProps {
  article: DocArticle;
  locale: string;
}

/**
 * Helper to parse inline markdown elements:
 * - Links: [label](url)
 * - Bold: **text**
 * - Inline Code: `text`
 * - Math: $text$
 * - Italic: *text*
 */
function renderInline(text: string): React.ReactNode[] {
  if (!text) return [];

  // Match links, bold, inline code, inline math, and italics
  const pattern =
    /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|\$([^$]+)\$|\*([^*]+)\*/g;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.substring(lastIndex, match.index));
    }

    if (match[1] !== undefined && match[2] !== undefined) {
      // Link [label](url)
      const label = match[1];
      const url = match[2];
      const isExternal =
        url.startsWith("http://") || url.startsWith("https://");

      nodes.push(
        isExternal ? (
          <a
            key={match.index}
            href={url}
            target="_blank"
            rel="noreferrer"
            className="text-primary font-medium underline hover:opacity-80 transition"
          >
            {label}
          </a>
        ) : (
          <Link
            key={match.index}
            href={url}
            className="text-primary font-medium underline hover:opacity-80 transition"
          >
            {label}
          </Link>
        )
      );
    } else if (match[3] !== undefined) {
      // Bold **text**
      nodes.push(
        <strong key={match.index} className="font-semibold text-on-surface">
          {match[3]}
        </strong>
      );
    } else if (match[4] !== undefined) {
      // Code `text`
      nodes.push(
        <code
          key={match.index}
          className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-xs sm:text-sm text-primary border border-outline-variant/20"
        >
          {match[4]}
        </code>
      );
    } else if (match[5] !== undefined) {
      // Math $text$
      nodes.push(
        <span
          key={match.index}
          className="font-mono text-xs sm:text-sm text-emerald-300 bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-500/20"
        >
          {match[5]}
        </span>
      );
    } else if (match[6] !== undefined) {
      // Italic *text*
      nodes.push(
        <em key={match.index} className="italic text-on-surface">
          {match[6]}
        </em>
      );
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.substring(lastIndex));
  }

  return nodes;
}

export function DocArticleViewer({ article, locale }: DocArticleViewerProps) {
  const targetLocale = (locale === "es" ? "es" : "en") as "en" | "es";
  const title = article.title[targetLocale] || article.title.en;
  const categoryTitle =
    article.categoryTitle?.[targetLocale] ||
    article.categoryTitle?.en ||
    "Documentation";
  const rawContent = article.content[targetLocale] || article.content.en;

  // Navigation indices
  const currentIndex = DOC_ARTICLES.findIndex(
    (a) => a.categorySlug === article.categorySlug && a.slug === article.slug
  );
  const prevArticle = currentIndex > 0 ? DOC_ARTICLES[currentIndex - 1] : null;
  const nextArticle =
    currentIndex >= 0 && currentIndex < DOC_ARTICLES.length - 1
      ? DOC_ARTICLES[currentIndex + 1]
      : null;

  // Multi-pass Block Parser
  const renderFormattedBlocks = (content: string) => {
    const lines = content.trim().split("\n");
    const blocks: React.ReactNode[] = [];
    let idx = 0;

    while (idx < lines.length) {
      const line = lines[idx];
      const trimmed = line.trim();

      // 1. Skip empty lines
      if (!trimmed) {
        idx++;
        continue;
      }

      // 2. Horizontal Rule (---)
      if (trimmed === "---") {
        blocks.push(
          <hr key={`hr-${idx}`} className="my-6 border-outline-variant/15" />
        );
        idx++;
        continue;
      }

      // 3. Multi-line Code Block (```)
      if (trimmed.startsWith("```")) {
        const lang = trimmed.replace("```", "").trim();
        const codeLines: string[] = [];
        idx++;
        while (idx < lines.length && !lines[idx].trim().startsWith("```")) {
          codeLines.push(lines[idx]);
          idx++;
        }
        if (idx < lines.length) idx++; // Skip closing ```

        blocks.push(
          <div
            key={`code-${idx}`}
            className="my-4 rounded-xl bg-black/60 p-4 font-mono text-xs sm:text-sm leading-relaxed text-primary-container overflow-x-auto border border-outline-variant/20 shadow-inner"
          >
            {lang && (
              <div className="text-xs uppercase font-bold text-on-surface-variant/50 border-b border-white/10 pb-1 mb-2">
                {lang}
              </div>
            )}
            <pre className="whitespace-pre">
              <code>{codeLines.join("\n")}</code>
            </pre>
          </div>
        );
        continue;
      }

      // 4. GitHub-style Alert Callout (> [!NOTE], > [!TIP], etc.)
      if (trimmed.startsWith("> [!")) {
        const match = trimmed.match(
          /^>\s*\[!(NOTE|TIP|WARNING|CAUTION|IMPORTANT)\]/i
        );
        if (match) {
          const alertType = match[1].toUpperCase() as
            | "NOTE"
            | "TIP"
            | "WARNING"
            | "CAUTION"
            | "IMPORTANT";
          const calloutLines: string[] = [];
          idx++;

          while (idx < lines.length && lines[idx].trim().startsWith(">")) {
            calloutLines.push(lines[idx].trim().replace(/^>\s*/, ""));
            idx++;
          }

          let borderStyle = "border-sky-500/40 bg-sky-500/10 text-sky-200";
          let icon = "ℹ️";

          if (alertType === "TIP") {
            borderStyle =
              "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
            icon = "💡";
          } else if (alertType === "WARNING") {
            borderStyle = "border-amber-500/40 bg-amber-500/10 text-amber-200";
            icon = "⚠️";
          } else if (alertType === "CAUTION") {
            borderStyle = "border-rose-500/40 bg-rose-500/10 text-rose-200";
            icon = "🚨";
          } else if (alertType === "IMPORTANT") {
            borderStyle =
              "border-purple-500/40 bg-purple-500/10 text-purple-200";
            icon = "⚡";
          }

          blocks.push(
            <div
              key={`callout-${idx}`}
              className={`my-4 rounded-xl border p-4 text-sm sm:text-base space-y-1.5 backdrop-blur-md shadow-md ${borderStyle}`}
            >
              <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-xs">
                <span>{icon}</span>
                <span>{alertType}</span>
              </div>
              <div className="space-y-1 leading-relaxed opacity-95">
                {calloutLines.map((cLine, cIdx) => (
                  <p key={cIdx}>{renderInline(cLine)}</p>
                ))}
              </div>
            </div>
          );
          continue;
        }
      }

      // 5. Markdown Table (| Col 1 | Col 2 |)
      if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
        const tableLines: string[] = [];
        while (
          idx < lines.length &&
          lines[idx].trim().startsWith("|") &&
          lines[idx].trim().endsWith("|")
        ) {
          tableLines.push(lines[idx].trim());
          idx++;
        }

        if (tableLines.length >= 2) {
          // Parse Header
          const headerCols = tableLines[0]
            .split("|")
            .filter((_, i, arr) => i > 0 && i < arr.length - 1)
            .map((c) => c.trim());

          // Skip Divider row if present (| :--- | :--- |)
          const bodyStartIndex = tableLines[1].includes("---") ? 2 : 1;
          const bodyRows = tableLines.slice(bodyStartIndex).map((row) =>
            row
              .split("|")
              .filter((_, i, arr) => i > 0 && i < arr.length - 1)
              .map((c) => c.trim())
          );

          blocks.push(
            <div
              key={`table-${idx}`}
              className="my-5 overflow-x-auto rounded-xl border border-outline-variant/20 bg-surface-container-high/40 shadow-inner"
            >
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-container-high text-on-surface font-semibold border-b border-outline-variant/20 text-xs sm:text-sm">
                  <tr>
                    {headerCols.map((col, hIdx) => (
                      <th key={hIdx} className="px-4 py-2.5">
                        {renderInline(col)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/10 text-on-surface-variant text-xs sm:text-sm">
                  {bodyRows.map((row, rIdx) => (
                    <tr
                      key={rIdx}
                      className="hover:bg-surface-container-highest/30 transition"
                    >
                      {row.map((cell, cIdx) => (
                        <td key={cIdx} className="px-4 py-2.5">
                          {renderInline(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
          continue;
        }
      }

      // 6. Headers (#, ##, ###)
      if (trimmed.startsWith("# ")) {
        blocks.push(
          <h1
            key={`h1-${idx}`}
            className="font-display text-3xl md:text-4xl font-extrabold tracking-tight text-on-surface my-4"
          >
            {renderInline(trimmed.replace("# ", ""))}
          </h1>
        );
        idx++;
        continue;
      }

      if (trimmed.startsWith("## ")) {
        blocks.push(
          <h2
            key={`h2-${idx}`}
            className="font-display text-2xl font-bold tracking-tight text-on-surface mt-8 mb-4 border-b border-outline-variant/15 pb-2"
          >
            {renderInline(trimmed.replace("## ", ""))}
          </h2>
        );
        idx++;
        continue;
      }

      if (trimmed.startsWith("### ")) {
        blocks.push(
          <h3
            key={`h3-${idx}`}
            className="font-display text-lg font-bold text-on-surface mt-6 mb-3"
          >
            {renderInline(trimmed.replace("### ", ""))}
          </h3>
        );
        idx++;
        continue;
      }

      // 7. Unordered List Items (- or *)
      if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
        const listItems: string[] = [];
        while (
          idx < lines.length &&
          (lines[idx].trim().startsWith("- ") ||
            lines[idx].trim().startsWith("* "))
        ) {
          listItems.push(lines[idx].trim().replace(/^[-*]\s*/, ""));
          idx++;
        }

        blocks.push(
          <ul
            key={`ul-${idx}`}
            className="my-3 space-y-2 pl-6 list-disc text-sm sm:text-base text-on-surface-variant"
          >
            {listItems.map((item, lIdx) => (
              <li key={lIdx} className="leading-relaxed">
                {renderInline(item)}
              </li>
            ))}
          </ul>
        );
        continue;
      }

      // 8. Ordered List Items (1. 2.)
      if (/^\d+\.\s/.test(trimmed)) {
        const listItems: string[] = [];
        while (idx < lines.length && /^\d+\.\s/.test(lines[idx].trim())) {
          listItems.push(lines[idx].trim().replace(/^\d+\.\s*/, ""));
          idx++;
        }

        blocks.push(
          <ol
            key={`ol-${idx}`}
            className="my-3 space-y-2 pl-6 list-decimal text-sm sm:text-base text-on-surface-variant"
          >
            {listItems.map((item, lIdx) => (
              <li key={lIdx} className="leading-relaxed">
                {renderInline(item)}
              </li>
            ))}
          </ol>
        );
        continue;
      }

      // 9. Default Paragraph
      blocks.push(
        <p
          key={`p-${idx}`}
          className="text-sm sm:text-base text-on-surface-variant leading-relaxed my-3"
        >
          {renderInline(trimmed)}
        </p>
      );
      idx++;
    }

    return blocks;
  };

  return (
    <article className="max-w-4xl w-full">
      {/* Breadcrumb Header */}
      <nav className="flex items-center gap-2 text-sm text-on-surface-variant/70 mb-4">
        <Link href="/docs" className="hover:text-on-surface transition">
          Docs
        </Link>
        <span>/</span>
        <span>{categoryTitle}</span>
        <span>/</span>
        <span className="text-primary font-medium">{title}</span>
      </nav>

      {/* Main Content Area */}
      <div className="rounded-2xl bg-surface-container-low/70 border border-outline-variant/20 p-6 md:p-8 backdrop-blur-xl shadow-xl space-y-4">
        {renderFormattedBlocks(rawContent)}

        {/* Embedded Interactive Error Decoder for common-errors page */}
        {article.slug === "common-errors" && (
          <ErrorDecoderTool locale={locale} />
        )}
      </div>

      {/* Previous / Next Article Links */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
        {prevArticle ? (
          <Link
            href={`/docs/${prevArticle.categorySlug}/${prevArticle.slug}`}
            className="group rounded-2xl bg-surface-container-low border border-outline-variant/20 p-4 hover:border-primary/50 transition flex flex-col justify-between"
          >
            <span className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant/60">
              ← {locale === "es" ? "Anterior" : "Previous"}
            </span>
            <span className="text-base font-bold text-on-surface group-hover:text-primary transition mt-1">
              {prevArticle.title[targetLocale] || prevArticle.title.en}
            </span>
          </Link>
        ) : (
          <div />
        )}

        {nextArticle ? (
          <Link
            href={`/docs/${nextArticle.categorySlug}/${nextArticle.slug}`}
            className="group rounded-2xl bg-surface-container-low border border-outline-variant/20 p-4 hover:border-primary/50 transition flex flex-col items-end text-right justify-between"
          >
            <span className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant/60">
              {locale === "es" ? "Siguiente" : "Next"} →
            </span>
            <span className="text-base font-bold text-on-surface group-hover:text-primary transition mt-1">
              {nextArticle.title[targetLocale] || nextArticle.title.en}
            </span>
          </Link>
        ) : (
          <div />
        )}
      </div>
    </article>
  );
}
