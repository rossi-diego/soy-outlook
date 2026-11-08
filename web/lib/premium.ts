"use client";

// The Paranaguá premium is a user input only (owner decision, 2026-11-08): there is no licensed
// source, so the repository ships no premium data and no default. Until the viewer types a quote
// the site shows CBOT ¢/bu, CBOT USD/t and CBOT in R$/sack ("CBOT only, excl. premium"); FOB
// values appear only once a premium is entered. The typed value is kept per viewer in
// localStorage (a convenience only: every read and write is wrapped, and the page works without it).
import { useSyncExternalStore } from "react";

import { num } from "./format";
import type { Locale } from "./i18n";

export const PREMIUM_KEY = "soy-outlook.premium-c-bu";
export const PREMIUM_EVENT = "soy-outlook-premium-change";
export const PREMIUM_MIN = -300;
export const PREMIUM_MAX = 300;

export type PremiumParse = { ok: true; value: number | null } | { ok: false; error: string };

/**
 * Parse a typed premium in US cents per bushel ("80", "+80", "-12", "−12", "82,5").
 * Empty means no premium (CBOT only). Rejects anything outside PREMIUM_MIN..PREMIUM_MAX.
 */
export function parsePremium(text: string, loc: Locale = "en"): PremiumParse {
  const t = text.trim().replace(/\s+/g, "").replace("−", "-").replace(/^\+/, "").replace(",", ".");
  if (t === "") return { ok: true, value: null };
  const pt = loc === "pt-BR";
  const v = Number(t);
  if (!/^-?\d+(\.\d+)?$/.test(t) || v < PREMIUM_MIN || v > PREMIUM_MAX)
    return {
      ok: false,
      error: pt
        ? `Digite um prêmio entre ${PREMIUM_MIN} e +${PREMIUM_MAX} ¢/bu, ou deixe vazio.`
        : `Enter a premium between ${PREMIUM_MIN} and +${PREMIUM_MAX} ¢/bu, or leave it empty.`,
    };
  return { ok: true, value: Math.round(v * 100) / 100 };
}

/** The value as it goes back into the text field ("80", "-12,5"): no sign for positives. */
export function premiumInputText(v: number | null, loc: Locale = "en"): string {
  if (v === null) return "";
  const d = Number.isInteger(v) ? 0 : 2;
  return num(v, d, loc); // |v| <= 300, so there is never a thousands separator
}

/** The stored premium, or null when none was typed (or storage is unavailable or corrupt). */
export function readPremium(): number | null {
  try {
    const raw = window.localStorage.getItem(PREMIUM_KEY);
    if (raw === null) return null;
    const r = parsePremium(raw);
    return r.ok ? r.value : null;
  } catch {
    return null;
  }
}

/** Store (or, with null, forget) the viewer's premium and notify every subscriber. */
export function writePremium(v: number | null): void {
  try {
    if (v === null) window.localStorage.removeItem(PREMIUM_KEY);
    else window.localStorage.setItem(PREMIUM_KEY, String(v));
    writeFailed = false;
  } catch {
    // Storage unavailable or full: the value still applies in memory for this page view, and the
    // snapshot must not fall back to a stale stored value that a failed write left behind.
    writeFailed = true;
  }
  memory = v;
  window.dispatchEvent(new Event(PREMIUM_EVENT));
}

// Fallback when localStorage throws (private mode, blocked site data): the last written value.
let memory: number | null = null;
let writeFailed = false;

function snapshot(): number | null {
  if (writeFailed) return memory;
  try {
    window.localStorage.getItem(PREMIUM_KEY);
  } catch {
    return memory;
  }
  return readPremium();
}

function subscribe(cb: () => void) {
  window.addEventListener(PREMIUM_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(PREMIUM_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** The viewer's premium (¢/bu) or null. Server render and hydration use null (CBOT only). */
export function usePremium(): [number | null, (v: number | null) => void] {
  const v = useSyncExternalStore(subscribe, snapshot, () => null);
  return [v, writePremium];
}
