import type { Metadata, Viewport } from "next";
import Link from "next/link";

import FreshnessBanner from "@/components/FreshnessBanner";
import ThemeToggle, { themeBootScript } from "@/components/ThemeToggle";
import { getMeta } from "@/lib/data";
import { dateLabel, monthLabel } from "@/lib/format";
import { AUTHOR, OG_IMAGE, REPO_URL, SITE_NAME, SITE_URL } from "@/lib/site";

import "./globals.css";

const DESCRIPTION =
  "Price-risk ranges for Brazilian export soybeans 1, 3 and 6 months after each USDA WASDE report, for budgeting and hedging: tested ranges labelled by their hit rate, an honest track record against 'no change', and what each WASDE revision has been worth on release day.";
const DEFAULT_TITLE = `${SITE_NAME}: Brazilian soybean prices after each WASDE`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: DEFAULT_TITLE, template: `%s · ${SITE_NAME}` },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: AUTHOR.name, url: AUTHOR.linkedin }],
  creator: AUTHOR.name,
  keywords: ["soybeans", "WASDE", "CBOT", "Paranaguá", "FOB", "forecast", "commodity", "market risk", "Brazil"],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_US",
    url: "/",
    title: DEFAULT_TITLE,
    description: DESCRIPTION,
    images: [OG_IMAGE],
  },
  twitter: { card: "summary_large_image", title: DEFAULT_TITLE, description: DESCRIPTION, images: [OG_IMAGE.url] },
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
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icon.svg" alt="" aria-hidden width={28} height={28} className="h-7 w-7 rounded-md" />
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
              {/* The as-of date stays visible on every width; the next-WASDE date joins it from sm up. */}
              <span data-testid="as-of">
                <span className="hidden sm:inline">CBOT close </span>
                <span className="sm:hidden">Close </span>
                <strong className="text-ink">{dateLabel(meta.as_of_close)}</strong>
                {meta.next_wasde && <span className="hidden sm:inline"> · next WASDE {dateLabel(meta.next_wasde)}</span>}
              </span>
              <ThemeToggle />
            </div>
          </div>
        </header>
        <FreshnessBanner freshness={meta.freshness} />
        <main id="main" className="mx-auto max-w-6xl px-4 py-8">
          {children}
        </main>
        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-6xl flex-col gap-y-2 px-4 py-6 text-xs text-muted">
            <p className="text-sm text-ink-2">
              Built by <strong className="text-ink">{AUTHOR.name}</strong> ·{" "}
              <a className="underline hover:text-ink" href={AUTHOR.linkedin}>
                LinkedIn
              </a>{" "}
              ·{" "}
              <a className="underline hover:text-ink" href={AUTHOR.github}>
                GitHub
              </a>{" "}
              ·{" "}
              <Link className="underline hover:text-ink" href="/methodology/#about">
                About
              </Link>
            </p>
            <p>
              Sources: USDA WASDE ({monthLabel(meta.latest_wasde.month)}, via{" "}
              <a className="underline hover:text-ink" href="https://wasde-tracker.vercel.app">
                WASDE Tracker
              </a>
              ), CBOT soybean futures (Yahoo Finance, delayed, front month), BCB PTAX, and a derived, stale Paranaguá
              premium table.
            </p>
            <p>
              Research and educational use only; not investment, trading or hedging advice. Ranges describe past forecast
              errors, not a guarantee; FOB and R$ values are illustrative until you enter your own premium quote.
            </p>
            <p>
              Generated {meta.generated_at.slice(0, 16).replace("T", " ")} UTC ·{" "}
              <a className="underline hover:text-ink" href="/data/backtest.csv">
                backtest.csv
              </a>{" "}
              ·{" "}
              <a className="underline hover:text-ink" href="/data/outlook.json">
                outlook.json
              </a>{" "}
              ·{" "}
              <a className="underline hover:text-ink" href={REPO_URL}>
                Source code
              </a>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
