import type { Metadata } from "next";

// Public site identity. NEXT_PUBLIC_SITE_URL overrides the production URL (e.g. for a preview deploy).
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://soy-outlook.vercel.app").replace(/\/$/, "");
export const SITE_NAME = "Soy Outlook";
export const AUTHOR = {
  name: "Diego Rossi",
  linkedin: "https://www.linkedin.com/in/rossi-diego/",
  github: "https://github.com/rossi-diego",
};
export const REPO_URL = "https://github.com/rossi-diego/soy-outlook";

/** Static, branded card: the question and the honest headline, no live price range. */
export const OG_IMAGE = {
  url: "/og.png",
  width: 1200,
  height: 630,
  alt: "Soy Outlook: price-risk ranges for Brazilian export soybeans, for budgeting and hedging. Tested on every WASDE since 2016, no model beats no-change.",
};

/** Per-page metadata: title (templated in the root layout), description, canonical URL and social cards. */
export function pageMetadata(path: string, title: string | null, description: string): Metadata {
  const fullTitle = title ? `${title} · ${SITE_NAME}` : `${SITE_NAME}: Brazilian soybean prices after each WASDE`;
  return {
    ...(title ? { title } : {}),
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "en_US",
      url: path,
      title: fullTitle,
      description,
      images: [OG_IMAGE],
    },
    twitter: { card: "summary_large_image", title: fullTitle, description, images: [OG_IMAGE.url] },
  };
}

export const PAGES = [
  { path: "/", priority: 1 },
  { path: "/wasde/", priority: 0.8 },
  { path: "/track-record/", priority: 0.8 },
  { path: "/methodology/", priority: 0.6 },
] as const;
