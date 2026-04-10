/**
 * Find the nationality input by searching the DOM around "Nationality" text
 */
import { chromium } from "playwright";
import { searchFlightsApi } from "../src/services/wakanow/api-search.js";

async function main() {
  const search = await searchFlightsApi({ origin: "Lagos", destination: "Abuja", departureDate: "2026-04-15", maxResults: 1 });
  const browser = await chromium.launch({ headless: true, args: ["--disable-http2", "--disable-blink-features=AutomationControlled"] });
  const context = await browser.newContext({ locale: "en-NG", timezoneId: "Africa/Lagos", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36" });
  const page = await context.newPage();

  await page.goto(search.results[0].deeplink, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.locator("div.flight-fare-detail-wrap").first().waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForTimeout(3000);
  await page.locator("div.flight-fare-detail-wrap").first().locator("text=Book Now").first().click({ timeout: 5000 });
  await page.waitForURL(/\/booking\/.*\/customer-info/i, { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(5000);

  // Get the HTML around "Nationality" label
  const natHTML = await page.evaluate(() => {
    const labels = document.querySelectorAll("label");
    for (const label of labels) {
      if ((label.textContent ?? "").toLowerCase().includes("nationality")) {
        // Get parent container and its HTML
        const parent = label.closest("div.form-group, div.col, div.mb-3, div.row") ?? label.parentElement;
        return parent?.innerHTML?.slice(0, 2000) ?? "parent not found";
      }
    }
    // Try searching for any element with nationality text
    const all = document.querySelectorAll("*");
    for (const el of all) {
      if (el.children.length === 0 && (el.textContent ?? "").trim().toLowerCase() === "nationality") {
        const parent = el.closest("div") ?? el.parentElement;
        return `[found via text] ${parent?.innerHTML?.slice(0, 2000)}`;
      }
    }
    return "NOT FOUND";
  });
  console.log("Nationality HTML:");
  console.log(natHTML);

  // Also check if nationality is pre-filled
  const natState = await page.evaluate(() => {
    // Look for any input near nationality text
    const inputs = document.querySelectorAll("input");
    const results: any[] = [];
    for (const inp of inputs) {
      const parent = inp.closest("div.form-group, div.col, div.mb-3");
      if (parent && (parent.textContent ?? "").includes("Nationality")) {
        results.push({
          type: inp.type,
          value: inp.value,
          formcontrolname: inp.getAttribute("formcontrolname"),
          placeholder: inp.placeholder,
          class: inp.className.slice(0, 80),
          disabled: inp.disabled,
          id: inp.id
        });
      }
    }
    return results;
  });
  console.log("\nNationality-related inputs:");
  console.log(JSON.stringify(natState, null, 2));

  // Check gender state
  const genderState = await page.evaluate(() => {
    const male = document.getElementById("Male0") as HTMLInputElement;
    const female = document.getElementById("Female0") as HTMLInputElement;
    return {
      male: male ? { disabled: male.disabled, checked: male.checked } : null,
      female: female ? { disabled: female.disabled, checked: female.checked } : null
    };
  });
  console.log("\nGender state:");
  console.log(JSON.stringify(genderState));

  await browser.close();
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
