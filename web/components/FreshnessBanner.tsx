"use client";

import { useSyncExternalStore } from "react";

import { staleReasons } from "@/lib/freshness";
import type { Freshness } from "@/lib/types";

// The clock is read on the client only: the static HTML is built once, but "stale" depends on when it is viewed.
const MINUTE = 60_000;
const subscribe = (cb: () => void) => {
  const id = window.setInterval(cb, 5 * MINUTE);
  return () => window.clearInterval(id);
};
const minuteBucket = () => Math.floor(Date.now() / MINUTE);

export default function FreshnessBanner({ freshness }: { freshness: Freshness }) {
  const bucket = useSyncExternalStore<number | null>(subscribe, minuteBucket, () => null);
  if (bucket === null) return null;
  const reasons = staleReasons(freshness, new Date(bucket * MINUTE));
  if (reasons.length === 0) return null;
  return (
    <div className="border-b border-warn-line/40 bg-warn-soft" role="status" data-testid="stale-banner">
      <div className="mx-auto flex max-w-6xl items-start gap-3 px-4 py-2.5 text-sm">
        <svg aria-hidden viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-warn" fill="currentColor">
          <path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm.75 4.5v4.25a.75.75 0 0 1-1.5 0V6.5a.75.75 0 0 1 1.5 0ZM10 14.75a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
        </svg>
        <div className="min-w-0">
          <p className="font-medium text-warn">These numbers may be out of date</p>
          <ul className="mt-0.5 space-y-0.5 text-ink-2">
            {reasons.map((r) => (
              <li key={r.id} data-reason={r.id}>
                {r.text}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
