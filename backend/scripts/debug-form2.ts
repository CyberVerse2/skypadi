/**
 * Quick debug: find the nationality input element on the customer-info page
 */
import { chromium } from "playwright";
import { searchFlightsApi } from "../src/services/wakanow/api-search.js";

async function main() {
  const search = await searchFlightsApi({ origin: "Lagos", destination: "Abuja", departureDate: "2026-04-15", maxResults: 1 });
  const flight = search.results[0];

  const browser = await chromium.launch({ headless: true, args: ["--disable-http2", "--disable-blink-features=AutomationControlled"] });
  const context = await browser.newContext({ locale: "en-NG", timezoneId: "Africa/Lagos", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36" });
  const page = await context.newPage();

  await page.goto(flight.deeplink, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.locator("div.flight-fare-detail-wrap").first().waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForTimeout(3000);
  await page.locator("div.flight-fare-detail-wrap").first().locator("text=Book Now").first().click({ timeout: 5000 });
  await page.waitForURL(/\/booking\/.*\/customer-info/i, { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(5000);

  // Find ALL inputs and their attributes
  const inputs = await page.evaluate(() => {
    const els = document.querySelectorAll("input, select, textarea");
    return Array.from(els).map(el => ({
      tag: el.tagName,
      type: el.getAttribute("type"),
      name: el.getAttribute("name"),
      id: el.id,
      formcontrolname: el.getAttribute("formcontrolname"),
      placeholder: el.getAttribute("placeholder"),
      class: el.className.slice(0, 60),
      disabled: (el as HTMLInputElement).disabled
    }));
  });

  console.log("All form elements:");
  for (const inp of inputs) {
    if (inp.name || inp.formcontrolname || inp.id) {
      console.log(`  ${inp.tag} name="${inp.name}" fc="${inp.formcontrolname}" id="${inp.id}" type="${inp.type}" placeholder="${inp.placeholder}" disabled=${inp.disabled}`);
    }
  }

  // Specifically look for nationality-related elements
  const natElements = await page.evaluate(() => {
    const all = document.querySelectorAll("*");
    const matches: any[] = [];
    for (const el of all) {
      const text = (el as HTMLElement).innerText?.toLowerCase() || "";
      const attrs = Array.from(el.attributes).map(a => `${a.name}=${a.value}`).join(" ");
      if (attrs.toLowerCase().includes("national") || (el.tagName === "LABEL" && text.includes("national"))) {
        matches.push({ tag: el.tagName, attrs: attrs.slice(0, 200), text: text.slice(0, 50) });
      }
    }
    return matches.slice(0, 10);
  });
  console.log("\nNationality-related elements:");
  for (const el of natElements) {
    console.log(`  ${el.tag}: ${el.attrs}`);
  }

  await browser.close();
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
