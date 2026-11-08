"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import type { AnalystData } from "@/components/AnalystOutlook";
import type { Meta } from "@/lib/types";
import { useI18n } from "@/lib/useI18n";

// The body is fetched on first open, so /track-record/ keeps its first-load JavaScript and HTML
// inside the size budget (P28).
const Body = dynamic(() => import("@/components/AnalystOutlook"), {
  ssr: false,
  loading: () => <div className="chart-skeleton mt-4 h-64" aria-busy="true" />,
});

/**
 * "For analysts": today's outlook in full detail, folded at the foot of the track record. It holds
 * what the home page story leaves out: the per-horizon cards with hedge contracts and rolls, how to
 * read the ranges, the full hedging panel with the target-price readout, and the stress replay.
 */
export default function ForAnalysts({ meta, outlook }: { meta: Meta; outlook: AnalystData }) {
  const { t } = useI18n();
  const [opened, setOpened] = useState(false);
  return (
    <details
      className="card p-5 text-sm"
      id="for-analysts"
      data-testid="for-analysts"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) setOpened(true);
      }}
    >
      <summary className="cursor-pointer text-base font-semibold">
        {t(
          "For analysts: today's ranges in detail, the full hedging panel and the stress replay",
          "Para analistas: as faixas de hoje em detalhe, o painel completo de hedge e o teste de estresse",
        )}
      </summary>
      {opened && <Body meta={meta} outlook={outlook} />}
    </details>
  );
}
