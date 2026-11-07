import type { Metadata, Viewport } from "next";
import Link from "next/link";

import ThemeToggle, { themeBootScript } from "@/components/ThemeToggle";
import { getMeta } from "@/lib/data";
import { dateLabel, monthLabel } from "@/lib/format";

import "./globals.css";

export const metadata: Metadata = {
  title: "Soy Outlook",
  description:
    "Where Brazilian export soybeans could trade 1, 3 and 6 months after each USDA WASDE report — tested ranges, an honest track record against 'no change', and what each WASDE revision is worth on release day.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

const NAV = [
  { href: "/", label: "Outlook" },
  { href: "/wasde/", label: "This WASDE" },
  { href: "/track-record/", label: "Track record" },
  { href: "/methodology/", label: "Methodology" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const meta = getMeta();
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="min-h-screen">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        <header className="sticky top-0 z-20 border-b border-line bg-page/90 backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span aria-hidden className="grid h-7 w-7 place-items-center rounded-md bg-brand text-sm text-page">
                S
              </span>
              Soy Outlook
            </Link>
            <nav
              className="-mx-4 order-last flex w-[calc(100%+2rem)] items-center gap-1 overflow-x-auto whitespace-nowrap px-4 text-sm md:order-none md:mx-0 md:w-auto md:overflow-visible md:px-0"
              aria-label="Main"
            >
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  className="rounded-md px-2.5 py-1.5 text-ink-2 hover:bg-surface-2 hover:text-ink"
                  href={n.href}
                >
                  {n.label}
                </Link>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-3 text-xs text-muted">
              <span className="hidden sm:inline">
                CBOT close <strong className="text-ink">{dateLabel(meta.as_of_close)}</strong>
                {meta.next_wasde && <> · next WASDE {dateLabel(meta.next_wasde)}</>}
              </span>
              <ThemeToggle />
            </div>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-6xl px-4 py-8">
          {children}
        </main>
        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-6xl flex-wrap gap-x-6 gap-y-1 px-4 py-6 text-xs text-muted">
            <span>
              Sources: USDA WASDE ({monthLabel(meta.latest_wasde.month)}, via{" "}
              <a className="underline hover:text-ink" href="https://wasde-tracker.vercel.app">
                WASDE Tracker
              </a>
              ), CBOT soybean futures (Yahoo Finance, front month), BCB PTAX. Not investment advice.
            </span>
            <span>
              Generated {meta.generated_at.slice(0, 16).replace("T", " ")} UTC ·{" "}
              <a className="underline hover:text-ink" href="/data/backtest.csv">
                backtest.csv
              </a>{" "}
              ·{" "}
              <a className="underline hover:text-ink" href="/data/outlook.json">
                outlook.json
              </a>{" "}
              ·{" "}
              <a className="underline hover:text-ink" href="https://github.com/rossi-diego/sarimax-brazilian-soybean-forecasting">
                Source code
              </a>
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
