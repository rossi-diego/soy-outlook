import { expect, type Page, test } from "@playwright/test";

// P20: client-side pt-BR / en. The static HTML is English; the browser language picks the first
// locale, the header toggle overrides it and is remembered, and numbers never change with it.

const ROUTES = ["/", "/wasde/", "/track-record/", "/methodology/"];

async function setLocale(page: Page, loc: "en" | "pt-BR") {
  await page.addInitScript((l) => localStorage.setItem("soy-locale", l), loc);
}

/**
 * Every number in <main>, parsed with the locale's separators ("1,189.50" / "1.189,50") and
 * sorted, so the two locales can be compared as multisets. Charts are skipped: their axes are
 * drawn by ECharts, not by our copy.
 */
async function numbers(page: Page, loc: "en" | "pt-BR"): Promise<number[]> {
  const text = await page.evaluate(() => {
    // Text nodes joined with spaces, so "2026" next to "80" never reads as "202680".
    const skip = (el: Element | null) => !!el?.closest("[data-chart], svg, script, style");
    const walker = document.createTreeWalker(document.querySelector("main")!, NodeFilter.SHOW_TEXT);
    const parts: string[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (!skip(n.parentElement)) parts.push(n.textContent ?? "");
    return parts.join(" ");
  });
  // "ARIMA(0,1,1)" is a model name, not a number.
  const clean = text.replace(/ARIMA\(0,1,1\)/g, "ARIMA");
  const re = loc === "en" ? /\d+(?:,\d{3})*(?:\.\d+)?/g : /\d+(?:\.\d{3})*(?:,\d+)?/g;
  return (clean.match(re) ?? [])
    .map((s) => Number(loc === "en" ? s.replace(/,/g, "") : s.replace(/\./g, "").replace(",", ".")))
    .sort((a, b) => a - b);
}

async function openFolds(page: Page) {
  const n = await page.locator("main details").count();
  for (let i = 0; i < n; i++) {
    const d = page.locator("main details").nth(i);
    if (!(await d.evaluate((el) => (el as HTMLDetailsElement).open))) await d.locator("summary").first().click();
  }
  await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0, { timeout: 30_000 });
}

test.describe("browser language pt-BR", () => {
  test.use({ locale: "pt-BR" });

  test("first visit follows navigator.language: Portuguese copy, lang, R$/saca default", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("soja brasileira de exportação");
    await expect(page.getByRole("radio", { name: "FOB R$/saca" })).toBeChecked();
    // pt-BR number and date formatting: "R$ 132,45/sc", "6 nov 2026".
    await expect(page.getByTestId("headline")).toContainText(/R\$ \d{1,3}(\.\d{3})*,\d{2}\/sc/);
    await expect(page.getByTestId("as-of")).toContainText(/\d{1,2} (jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez) \d{4}/);
    // Port FOB is never called a port price without the fobbing caveat.
    await expect(page.locator("main")).not.toContainText(/preço porto/i);
    await expect(page.getByTestId("chart-caption")).toContainText("fobbing");
  });
});

test.describe("browser language English", () => {
  test.use({ locale: "en-US" });

  test("English stays the default, in USD/t", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("radio", { name: "FOB USD/t" })).toBeChecked();
    await expect(page.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true");
  });

  test("the toggle switches every page, sets <html lang> and is remembered", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Português (Brasil)" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await expect(page.getByRole("button", { name: "Português (Brasil)" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Metodologia" })).toBeVisible();
    await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Histórico" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Algum modelo superou");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Algum modelo superou");
    await page.getByRole("button", { name: "English" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Did any model beat");
  });

  test("a throwing localStorage does not break the toggle", async ({ page }) => {
    await page.addInitScript(() => {
      const boom = () => {
        throw new Error("storage disabled");
      };
      Storage.prototype.getItem = boom;
      Storage.prototype.setItem = boom;
    });
    await page.goto("/methodology/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Methodology");
    await page.getByRole("button", { name: "Português (Brasil)" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Metodologia");
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
  });

  test("optional port-to-interior discount: 0 by default, user-supplied, shifts R$/sack only", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("radio", { name: "FOB R$/sack" }).click();
    const basis = page.getByLabel("Port-to-interior discount (R$/sack)");
    await expect(basis).toHaveValue("");
    await expect(page.getByText(/there is no sourced regional default/)).toBeVisible();
    const card = page.getByTestId("horizon-1");
    const before = await card.locator("p.text-2xl").textContent();
    const [lo] = (before ?? "").split("–").map((s) => Number(s.trim().replace(/,/g, "")));
    await basis.fill("12.5");
    await basis.press("Enter");
    await expect(page.getByTestId("headline")).toContainText("est. local price");
    await expect(card.getByTestId("basis-row")).toContainText("12.50");
    const after = await card.locator("p.text-2xl").textContent();
    const [lo2] = (after ?? "").split("–").map((s) => Number(s.trim().replace(/,/g, "")));
    expect(lo2).toBeCloseTo(lo - 12.5, 2);
    // USD/t is untouched by a reais-per-sack discount.
    await page.getByRole("radio", { name: "FOB USD/t" }).click();
    await expect(page.getByTestId("headline")).toContainText("= FOB");
  });
});

for (const route of ROUTES)
  test(`numbers and caveats are identical in both locales: ${route}`, async ({ browser }) => {
    const read = async (loc: "en" | "pt-BR") => {
      const ctx = await browser.newContext({ locale: loc === "en" ? "en-US" : "pt-BR" });
      const page = await ctx.newPage();
      await setLocale(page, loc);
      await page.goto(route);
      await expect(page.locator("html")).toHaveAttribute("lang", loc);
      // Same unit in both locales, so the comparison is like for like.
      if (route === "/") await page.getByRole("radio", { name: "FOB USD/t" }).click();
      await openFolds(page);
      const out = await numbers(page, loc);
      await ctx.close();
      return out;
    };
    const en = await read("en");
    const pt = await read("pt-BR");
    expect(en.length).toBeGreaterThan(20);
    // Report the difference as two small multisets rather than two long arrays.
    const diff = (a: number[], b: number[]) => {
      const rest = [...b];
      return a.filter((x) => {
        const i = rest.indexOf(x);
        if (i < 0) return true;
        rest.splice(i, 1);
        return false;
      });
    };
    expect({ onlyEn: diff(en, pt), onlyPt: diff(pt, en) }).toEqual({ onlyEn: [], onlyPt: [] });
  });

test("pt-BR what-if button reads in plain Portuguese: lower-case months joined by 'contra'", async ({ page }) => {
  await setLocale(page, "pt-BR");
  await page.goto("/wasde/");
  await expect(page.getByRole("button", { name: /^Carregar o último/ })).toHaveText(
    /^Carregar o último \((janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro) contra [a-zç]+\)$/,
  );
});
