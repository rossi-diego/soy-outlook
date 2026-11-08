"use client";

import { useId } from "react";

export type RadioOption<T> = {
  id: T;
  /** Visible text. On phones `short` replaces it; both are part of `aria`, which stays the full name. */
  label: string;
  short?: string;
};

/**
 * A segmented control built from native radios in a fieldset (P27): arrow keys, the checked
 * state and the group name come from the browser, not from ARIA roles on buttons. The input
 * covers its label (transparent), so a click or tap always lands on the real control.
 */
export default function RadioGroup<T extends string | number>({
  legend,
  value,
  onChange,
  options,
  size = "md",
}: {
  legend: string;
  value: T;
  onChange: (v: T) => void;
  options: RadioOption<T>[];
  size?: "sm" | "md";
}) {
  const name = useId();
  const pad = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm";
  return (
    <fieldset className={`inline-flex min-w-0 rounded-lg border border-line bg-surface p-0.5 ${size === "sm" ? "text-xs" : "text-sm"}`}>
      <legend className="sr-only">{legend}</legend>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <label
            key={String(o.id)}
            className={`relative cursor-pointer whitespace-nowrap rounded-md ${pad} has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--accent)] ${
              on ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:text-ink"
            }`}
          >
            <input
              type="radio"
              name={name}
              value={String(o.id)}
              checked={on}
              onChange={() => onChange(o.id)}
              aria-label={o.short ? o.label : undefined}
              className="absolute inset-0 m-0 h-full w-full cursor-pointer appearance-none rounded-md opacity-0"
            />
            {o.short ? (
              <>
                <span className="sm:hidden">{o.short}</span>
                <span className="hidden sm:inline">{o.label}</span>
              </>
            ) : (
              o.label
            )}
          </label>
        );
      })}
    </fieldset>
  );
}
