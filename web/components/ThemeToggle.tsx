"use client";

import { useSyncExternalStore } from "react";

type Mode = "system" | "light" | "dark";
const KEY = "wasde-theme";

function apply(mode: Mode) {
  const el = document.documentElement;
  if (mode === "system") el.removeAttribute("data-theme");
  else el.setAttribute("data-theme", mode);
}

/** Runs before paint (inlined in <head>) so there is no theme flash. */
export const themeBootScript = `try{var m=localStorage.getItem("${KEY}");if(m==="light"||m==="dark")document.documentElement.setAttribute("data-theme",m)}catch(e){}`;

const EVENT = "wasde-theme-change";

function readMode(): Mode {
  try {
    const m = localStorage.getItem(KEY);
    return m === "light" || m === "dark" ? m : "system";
  } catch {
    return "system"; // storage unavailable
  }
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export default function ThemeToggle() {
  // Server and first client render agree on "system"; the stored choice follows without a hydration mismatch.
  const mode = useSyncExternalStore(subscribe, readMode, () => "system" as Mode);

  const next = () => {
    const order: Mode[] = ["system", "light", "dark"];
    const m = order[(order.indexOf(mode) + 1) % order.length];
    apply(m);
    try {
      if (m === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, m);
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event(EVENT));
  };

  const label = LABEL[mode];
  return (
    <button
      type="button"
      onClick={next}
      className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-2.5 text-xs text-ink-2 hover:bg-surface-2 hover:text-ink"
      aria-label={`Theme: ${label}. Click to change.`}
      title="Change theme (auto, light, dark)"
    >
      <Icon mode={mode} />
      <span>{label}</span>
    </button>
  );
}

const LABEL: Record<Mode, string> = { system: "Auto", light: "Light", dark: "Dark" };

function Icon({ mode }: { mode: Mode }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (mode === "dark")
    return (
      <svg {...common}>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    );
  if (mode === "light")
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  return (
    <svg {...common}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}
