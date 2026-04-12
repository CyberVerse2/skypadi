import { Bot, type Context, InlineKeyboard, InputFile, session } from "grammy";
import type { SessionFlavor } from "grammy";
import { env } from "../config.js";
import { handleMessage } from "./ai.js";
import { defaultSession, type SessionData } from "./session.js";
import { saveProfile as dbSaveProfile, getProfile as dbGetProfile } from "../db.js";

type BotContext = Context & SessionFlavor<SessionData>;

export function createBot() {
  const bot = new Bot<BotContext>(env.TELEGRAM_BOT_TOKEN!);

  bot.use(
    session({
      initial: defaultSession
    })
  );

  // ── /start ──────────────────────────────────────────────
  bot.command("start", async (ctx) => {
    ctx.session = defaultSession();
    const existing = dbGetProfile(ctx.from!.id);
    if (existing) {
      ctx.session.profile = existing;
      await ctx.reply(`Welcome back, ${existing.title} ${existing.firstName}! Ready to find flights. ✈️`);
    } else {
      ctx.session.onboarding = true;
      await runAI(ctx,
        "The user just started the bot. Welcome them briefly to SkyPadi and ask for their details to set up their profile: title, full name, date of birth, gender, phone number, and email. Be conversational — ask naturally, not as a form."
      );
    }
  });

  // ── /cancel ─────────────────────────────────────────────
  bot.command("cancel", async (ctx) => {
    const profile = ctx.session.profile;
    ctx.session = defaultSession();
    ctx.session.profile = profile; // keep profile
    await ctx.reply("Cleared. What would you like to do?");
  });

  // ── /profile ────────────────────────────────────────────
  bot.command("profile", async (ctx) => {
    const p = ctx.session.profile;
    if (!p) {
      await ctx.reply("No profile saved. Use /start to set one up.");
      return;
    }
    await ctx.reply(
      `${p.title} ${p.firstName}${p.middleName ? ` ${p.middleName}` : ""} ${p.lastName}\n` +
      `DOB: ${p.dateOfBirth}\n` +
      `Gender: ${p.gender}\n` +
      `Phone: ${p.phone}\n` +
      `Email: ${p.email}`
    );
  });

  // ── Callback: flight selection ─────────────────────────
  bot.callbackQuery(/^flight_(\d+)$/, async (ctx) => {
    const index = parseInt(ctx.match[1]);
    const results = ctx.session.searchResults;

    if (!results || index >= results.length) {
      await ctx.answerCallbackQuery({ text: "Flight not found. Try searching again." });
      return;
    }

    if (ctx.session.processing) {
      await ctx.answerCallbackQuery({ text: "Still working on your last request..." });
      return;
    }

    ctx.session.selectedFlightIndex = index;
    const flight = results[index];
    await ctx.answerCallbackQuery();

    const datePart = flight.date ? `\nDate: ${formatShortDate(flight.date)}` : "";
    const details = `✈️ *Flight ${index + 1}*\n` +
      `Airline: ${flight.airline}${datePart}\n` +
      `Departure: ${flight.departureTime}\n` +
      `Arrival: ${flight.arrivalTime}\n` +
      `Duration: ${flight.duration ?? "N/A"}\n` +
      `Stops: ${flight.stops}\n` +
      `Price: ${flight.priceText}`;

    const confirmKeyboard = new InlineKeyboard()
      .text("✅ Confirm Booking", `confirm_${index}`)
      .text("❌ Cancel", `cancel_book`);

    await ctx.reply(details, { parse_mode: "Markdown", reply_markup: confirmKeyboard });
  });

  // ── Callback: confirm booking ─────────────────────────
  bot.callbackQuery(/^confirm_(\d+)$/, async (ctx) => {
    const index = parseInt(ctx.match[1]);
    const results = ctx.session.searchResults;

    if (!results || index >= results.length) {
      await ctx.answerCallbackQuery({ text: "Flight not found. Try searching again." });
      return;
    }

    if (ctx.session.processing) {
      await ctx.answerCallbackQuery({ text: "Still working on your last request..." });
      return;
    }

    const flight = results[index];
    await ctx.answerCallbackQuery();
    await ctx.reply(`Booking ${flight.airline} ${flight.departureTime}→${flight.arrivalTime} ${flight.priceText}... ⏳`);

    await runAI(ctx, `The user confirmed booking flight ${index + 1}: ${flight.airline} ${flight.departureTime}→${flight.arrivalTime} ${flight.priceText}. Use the saved passenger profile and call bookFlight now — do NOT ask for any details.`);
  });

  // ── Callback: cancel booking ──────────────────────────
  bot.callbackQuery("cancel_book", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply("Booking cancelled. Pick another flight or search again.");
  });

  // ── All text messages → AI ─────────────────────────────
  bot.on("message:text", async (ctx) => {
    if (ctx.session.processing) {
      await ctx.reply("Still working on your last request...");
      return;
    }
    await runAI(ctx, ctx.message.text);
  });

  return bot;
}

function formatShortDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`);
  const day = d.getDate();
  const month = d.toLocaleString("en-US", { month: "short" });
  const weekday = d.toLocaleString("en-US", { weekday: "short" });
  return `${weekday} ${day} ${month}`;
}

async function runAI(ctx: BotContext, userText: string) {
  // Ensure profile is loaded from DB if not in session
  if (!ctx.session.profile && ctx.from) {
    const saved = dbGetProfile(ctx.from.id);
    if (saved) ctx.session.profile = saved;
  }

  ctx.session.processing = true;

  try {
    const result = await handleMessage(
      userText,
      ctx.session.history,
      ctx.session.searchResults,
      ctx.session.selectedFlightIndex,
      ctx.session.profile,
      ctx.session.onboarding,
      ctx.session.lastSearchRequest
    );

    ctx.session.history = result.updatedHistory;
    if (result.searchResults) ctx.session.searchResults = result.searchResults;
    if (result.selectedFlightIndex !== undefined) ctx.session.selectedFlightIndex = result.selectedFlightIndex;
    if (result.lastSearchRequest) ctx.session.lastSearchRequest = result.lastSearchRequest;
    if (result.profile) {
      ctx.session.profile = result.profile;
      ctx.session.onboarding = false;
      dbSaveProfile(ctx.from!.id, result.profile);
      console.log(`[profile] Saved profile for ${ctx.from!.id}`);
    }

    // If booking completed, send payment details
    if (result.paymentUrl) {
      if (result.reply) await ctx.reply(result.reply);

      // Show bank transfer details directly
      if (result.bankTransfers && result.bankTransfers.length > 0) {
        let bankMsg = "🏦 *Bank Transfer Details*\n\n";
        for (const bt of result.bankTransfers) {
          bankMsg += `*${bt.bank}*\nAccount: \`${bt.accountNumber}\`\nBeneficiary: ${bt.beneficiary}\n\n`;
        }
        bankMsg += `⏳ Expires in: ${result.bankTransfers[0].expiresIn}\n`;
        bankMsg += `⚠️ ${result.bankTransfers[0].note}`;
        await ctx.reply(bankMsg, { parse_mode: "Markdown" });
      }

      // Fallback: payment URL
      const payKeyboard = new InlineKeyboard()
        .url("💳 Pay Online Instead", result.paymentUrl);
      await ctx.reply("Or pay online:", { reply_markup: payKeyboard });
    }
    // If new search results, send as inline buttons
    else if (result.newSearch && result.searchResults && result.searchResults.length > 0) {
      const keyboard = new InlineKeyboard();
      result.searchResults.slice(0, 8).forEach((f, i) => {
        const datePart = f.date ? ` ${formatShortDate(f.date)}` : "";
        const label = `${i + 1}.${datePart} ${f.airline ?? "?"} ${f.departureTime ?? ""} — ${f.priceText ?? ""}`;
        keyboard.text(label, `flight_${i}`).row();
      });

      if (result.reply) await ctx.reply(result.reply);
      await ctx.reply("Tap a flight to book:", { reply_markup: keyboard });
    } else {
      await ctx.reply(result.reply || "Something went wrong. Try again.");
    }

    // Send debug screenshots if any (booking failures)
    if (result.debugScreenshots?.length) {
      for (const buf of result.debugScreenshots) {
        await ctx.replyWithPhoto(new InputFile(buf, "debug.png"), { caption: "Debug screenshot" }).catch(() => {});
      }
    }
  } catch (error) {
    console.error("AI handler error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    await ctx.reply(`Something went wrong: ${msg}\n\nTry again or use /cancel to start over.`);
  } finally {
    ctx.session.processing = false;
  }
}
