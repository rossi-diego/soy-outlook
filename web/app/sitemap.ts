import type { MetadataRoute } from "next";

import { getMeta } from "@/lib/data";
import { PAGES, SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  // Pages change when the pipeline publishes, so lastModified is the data's generation time.
  const lastModified = new Date(getMeta().generated_at);
  return PAGES.map((p) => ({
    url: `${SITE_URL}${p.path}`,
    lastModified,
    changeFrequency: "weekly",
    priority: p.priority,
  }));
}
