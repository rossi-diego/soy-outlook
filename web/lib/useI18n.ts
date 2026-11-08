"use client";

// React side of lib/i18n.ts: the locale as an external store, so the server render and
// hydration agree on "en" and the stored or browser choice follows without a mismatch.
import { useSyncExternalStore } from "react";

import { type Fmt, fmt } from "./format";
import { currentLocale, dataText, type Locale, LOCALE_EVENT } from "./i18n";

function subscribe(cb: () => void) {
  window.addEventListener(LOCALE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(LOCALE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** The active locale. Server render and hydration use "en"; the stored/browser choice follows. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, currentLocale, () => "en" as Locale);
}

/** Pick the copy for a locale. */
export const tr = <T,>(loc: Locale, en: T, pt: T): T => (loc === "pt-BR" ? pt : en);

const FMT: Record<Locale, Fmt> = { en: fmt("en"), "pt-BR": fmt("pt-BR") };

/**
 * Everything a component needs: the locale, `t(en, pt)` to pick copy, and formatters bound to the
 * locale. Copy lives next to the markup that uses it (both languages side by side), so a change to
 * one is visibly a change to the other.
 */
export function useI18n() {
  const loc = useLocale();
  const pt = loc === "pt-BR";
  return { loc, pt, t: <T,>(en: T, ptCopy: T): T => (pt ? ptCopy : en), f: FMT[loc], d: (s: string) => dataText(loc, s) };
}

