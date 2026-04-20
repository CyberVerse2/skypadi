/**
 * Verify the stealth.ts stack against known bot-detection sites.
 * Uses the exact production code path so results reflect real behavior.
 *
 * Usage:
 *   npx tsx scripts/smoke-stealth.ts            # headless
 *   HEADLESS=false npx tsx scripts/smoke-stealth.ts
 */
import "dotenv/config";
import { launchStealthBrowser, createStealthContext } from "../src/services/wakanow/stealth.js";

async function main() {
  const headless = process.env.HEADLESS !== "false";
  console.log(`Mode: ${headless ? "headless" : "headful"}`);

  const browser = await launchStealthBrowser({ headless });
  const context = await createStealthContext(browser);
  const page = await context.newPage();

  // --- Test 1: bot.sannysoft.com — classic detection matrix ---
  console.log("\n[1] bot.sannysoft.com");
  await page.goto("https://bot.sannysoft.com/", { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForTimeout(3000);
  const sannysoftResults = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("table tr"));
    return rows.map((r) => {
      const cells = r.querySelectorAll("td");
      if (cells.length < 2) return null;
      return {
        name: cells[0]?.textContent?.trim() ?? "",
        value: cells[1]?.textContent?.trim() ?? "",
        cls: cells[1]?.className ?? ""
      };
    }).filter(Boolean) as { name: string; value: string; cls: string }[];
  });
  let passed = 0, failed = 0, neutral = 0;
  const fails: string[] = [];
  for (const r of sannysoftResults) {
    if (r.cls.includes("passed") || /passed|^true$|^ok$/i.test(r.value)) passed++;
    else if (r.cls.includes("failed") || /failed|missing/i.test(r.value)) { failed++; fails.push(`${r.name}: ${r.value}`); }
    else neutral++;
  }
  console.log(`  passed=${passed} failed=${failed} neutral=${neutral}`);
  if (fails.length) console.log(`  FAILS: ${fails.slice(0, 5).join(" | ")}`);

  // --- Test 2: arh.antoinevastel.com headless detection ---
  console.log("\n[2] arh.antoinevastel.com/bots/areyouheadless");
  await page.goto("https://arh.antoinevastel.com/bots/areyouheadless", { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForTimeout(2000);
  const verdict = (await page.locator("#res").textContent().catch(() => ""))?.trim();
  console.log(`  verdict: ${verdict}`);

  await browser.close();
  console.log("\nDone.");
}

main().catch((e) => { console.error(e); process.exit(1); });
