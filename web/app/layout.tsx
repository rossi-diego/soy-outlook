import type { Metadata, Viewport } from "next";
import Link from "next/link";

import FreshnessBanner from "@/components/FreshnessBanner";
import { AsOf, LocaleToggle, MainNav, SiteFooter, SkipLink } from "@/components/SiteChrome";
import ThemeToggle from "@/components/ThemeToggle";
import { getMeta } from "@/lib/data";
import { localeBootScript } from "@/lib/i18n";
import { themeBootScript } from "@/lib/theme";
import { AUTHOR, OG_IMAGE, SITE_NAME, SITE_URL } from "@/lib/site";

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
    alternateLocale: ["pt_BR"],
    url: "/",
    title: DEFAULT_TITLE,
    description: DESCRIPTION,
    images: [OG_IMAGE],
  },
  twitter: { card: "summary_large_image", title: DEFAULT_TITLE, description: DESCRIPTION, images: [OG_IMAGE.url] },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const meta = getMeta();
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript + localeBootScript }} />
      </head>
      <body className="min-h-screen">
        <SkipLink />
        <header className="sticky top-0 z-20 border-b border-line bg-page/90 backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icon.svg" alt="" aria-hidden width={28} height={28} className="h-7 w-7 rounded-md" />
              Soy Outlook
            </Link>
            <MainNav />
            <div className="ml-auto flex items-center gap-2 text-xs text-muted sm:gap-3">
              <AsOf asOf={meta.as_of_close} nextWasde={meta.next_wasde} />
              <LocaleToggle />
              <ThemeToggle />
            </div>
          </div>
        </header>
        <FreshnessBanner freshness={meta.freshness} />
        <main id="main" className="mx-auto max-w-6xl px-4 py-8">
          {children}
        </main>
        <footer className="border-t border-line">
          <SiteFooter wasdeMonth={meta.latest_wasde.month} generatedAt={meta.generated_at} />
        </footer>
      </body>
    </html>
  );
}
