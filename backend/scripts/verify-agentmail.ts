/**
 * Full round-trip verification of the AgentMail client:
 *   create inbox → send mail to self → poll for receipt → parse body.
 *
 * Usage:
 *   npx tsx scripts/verify-agentmail.ts
 */
import "dotenv/config";
import * as agentmail from "../src/services/agentmail.js";

async function main() {
  if (!agentmail.isConfigured()) {
    console.error("AGENTMAIL_API_KEY not set in .env");
    process.exit(1);
  }

  console.log("[1/4] Creating inbox...");
  const inbox = await agentmail.createInbox(`verify-${Date.now()}`);
  console.log(`     ${inbox.email}`);

  console.log("\n[2/4] Listing messages (expect empty)...");
  const initial = await agentmail.listMessages(inbox.id);
  console.log(`     count=${initial.length}`);

  console.log("\n[3/4] Sending test mail to self (includes fake OTP '849372')...");
  const sent = await agentmail.sendMessage(inbox.id, {
    to: [inbox.email],
    subject: "Your Wakanow verification code",
    text: "Your verification code is 849372. It expires in 10 minutes."
  });
  console.log(`     sent message_id=${sent.message_id}`);

  console.log("\n[4/4] Polling for receipt (up to 60s)...");
  const received = await agentmail.waitForMessage(inbox.id, {
    timeoutMs: 60_000,
    pollMs: 3_000,
    matcher: (m) => /verification|Wakanow/i.test(m.subject)
  });
  if (!received) {
    console.log("     ❌ Timed out. Send works but list/poll does not deliver.");
    process.exit(1);
  }

  const body = agentmail.messageBody(received);
  const otp = agentmail.extractOtpCode(body);
  console.log(`     ✅ from=${received.from}`);
  console.log(`        subject=${received.subject}`);
  console.log(`        body=${body.slice(0, 120)}...`);
  console.log(`        OTP parsed: ${otp ?? "(none)"}`);

  if (otp !== "849372") {
    console.log("     ⚠️  OTP mismatch — regex may need tightening.");
    process.exit(1);
  }

  console.log("\n[cleanup] Deleting probe inbox...");
  await agentmail.deleteInbox(inbox.id);
  console.log("\n✅ All checks passed. AgentMail client is wired correctly.");
}

main().catch((e) => { console.error(e); process.exit(1); });
