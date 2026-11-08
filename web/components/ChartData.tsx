"use client";

import { useState } from "react";

import { useI18n } from "@/lib/useI18n";

/**
 * The numbers behind a chart as a plain table (P27), folded under the chart. Rendered on first
 * open, so long tables (the track-record paths) stay out of the static HTML and its size budget.
 */
export default function ChartData({
  caption,
  columns,
  rows,
  testId,
}: {
  caption: string;
  columns: string[];
  rows: (string | number)[][];
  testId?: string;
}) {
  const { t } = useI18n();
  const [opened, setOpened] = useState(false);
  return (
    <details
      className="text-xs text-ink-2"
      data-testid={testId}
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) setOpened(true);
      }}
    >
      <summary className="cursor-pointer select-none text-muted hover:text-ink">
        {t("Data table", "Tabela de dados")} <span className="sr-only">: {caption}</span>
      </summary>
      {opened && (
        // Scrollable, so it must be reachable by keyboard (axe scrollable-region-focusable).
        <div className="mt-2 max-h-80 overflow-auto rounded-md border border-line" tabIndex={0} role="region" aria-label={caption}>
          <table className="w-full text-left">
            <caption className="sr-only">{caption}</caption>
            <thead className="sticky top-0 bg-surface-2">
              <tr>
                {columns.map((c, i) => (
                  <th key={c} scope="col" className={`px-2 py-1.5 font-medium ${i > 0 ? "text-right" : ""}`}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-line">
                  {r.map((v, j) => (
                    <td key={j} className={`tabular px-2 py-1 ${j > 0 ? "text-right" : ""}`}>
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}
