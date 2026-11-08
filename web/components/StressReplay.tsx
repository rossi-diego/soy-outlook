"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import type { Stress } from "@/lib/types";
import { useI18n } from "@/lib/useI18n";

// The body (table, histogram, both locales' copy) is fetched on first open: it keeps the home
// page's HTML and first-load JavaScript inside the size budget (P28).
const Body = dynamic(() => import("@/components/StressBody"), {
  ssr: false,
  loading: () => <div className="chart-skeleton mt-4 h-64" aria-busy="true" />,
});

/**
 * P19 stress replay: what today's CBOT price becomes if a named past episode's realized h-month
 * move happened again, shown next to the full historical distribution of h-month moves.
 * Folded by default, and labelled as illustrative scenarios, not probabilities.
 */
export default function StressReplay({ stress, buPerT }: { stress: Stress; buPerT: number }) {
  const { t, d } = useI18n();
  const [opened, setOpened] = useState(false);
  return (
    <details
      className="card p-5"
      data-testid="stress-replay"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) setOpened(true);
      }}
    >
      <summary className="cursor-pointer text-lg font-semibold">
        {t("Stress replay: past shocks applied to today's price", "Teste de estresse: choques passados aplicados ao preço de hoje")}{" "}
        <span className="ml-1 rounded-full border border-line bg-surface-2 px-2 py-0.5 align-middle text-xs font-medium text-ink-2">
          {d(stress.label)}
        </span>
      </summary>
      {opened && <Body stress={stress} buPerT={buPerT} />}
    </details>
  );
}
