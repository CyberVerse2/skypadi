import { Bot, type Context, InlineKeyboard, session } from "grammy";
import type { SessionFlavor } from "grammy";
import { env } from "../config.js";
import { handleMessage } from "./ai.js";
import { defaultSession, type SessionData } from "./session.js";
import {
  saveBookingAttempt,
  saveProfile as dbSaveProfile,
  getProfile as dbGetProfile,
  touchUser
} from "../db.js";
import { ensureWallet } from "../services/wallet/index.js";

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
    let created = false;
    try {
      ({ created } = await ensureWallet(ctx.from!.id));
    } catch (err) {
      console.error(`[wallet] ensure failed for ${ctx.from!.id}:`, err);
    }
    await touchUser(ctx.from!.id);
    const existing = await dbGetProfile(ctx.from!.id);

    if (existing) {
      ctx.session.profile = existing;
      ctx.session.isFirstVisit = false;
      await ctx.reply(`Welcome back, ${existing.title} ${existing.firstName}! Where would you like to fly? ✈️`);
    } else {
      await ctx.reply(
        `Welcome to SkyPadi! ✈️\n\n` +
        `Tell me where you want to fly and I'll find the best flights.\n` +
        `Try: "Lagos to Dubai next Friday"`
      );
    }

    if (created) {
      await ctx.reply(`🪙 I've created a Stellar wallet for you. Use /wallet to see your address.`);
    }
  });

  // ── /wallet ────────────────────────────────────────────
  bot.command("wallet", async (ctx) => {
    const { record } = await ensureWallet(ctx.from!.id);
    await ctx.reply(
      `🪙 *Your Stellar Wallet*\n\nAddress: \`${record.publicKey}\``,
      { parse_mode: "Markdown" }
    );
  });

  // ── /cancel ─────────────────────────────────────────────
  bot.command("cancel", async (ctx) => {
    const profile = ctx.session.profile;
    ctx.session = defaultSession();
    ctx.session.profile = profile; // keep profile
    ctx.session.isFirstVisit = false;
    await ctx.reply("Fresh start. Where would you like to fly?");
  });

  // ── /profile ────────────────────────────────────────────
  bot.command("profile", async (ctx) => {
    const p = ctx.session.profile;
    if (!p) {
      await ctx.reply("No profile saved yet. I'll ask for your details when you're ready to book a flight.");
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

    // If no profile, collect it now (backloaded friction)
    if (!ctx.session.profile) {
      ctx.session.onboarding = true;
      ctx.session.selectedFlightIndex = index;
      await ctx.reply(
        `Great choice! ${flight.airline} ${flight.departureTime}→${flight.arrivalTime} ${flight.priceText}\n\n` +
        `To book this flight, I need a few details first.`
      );
      await runAI(ctx,
        "The user wants to book a flight but has no profile yet. Collect their details conversationally: title (Mr/Ms/Mrs/Miss/Dr), full name, date of birth (YYYY-MM-DD), gender, phone, and email. Once done, call saveProfile, then immediately proceed to book the selected flight."
      );
      return;
    }

    await ctx.reply(`Booking ${flight.airline} ${flight.departureTime}→${flight.arrivalTime} ${flight.priceText}... ⏳`);
    await runAI(ctx, `The user confirmed booking flight ${index + 1}: ${flight.airline} ${flight.departureTime}→${flight.arrivalTime} ${flight.priceText}. Use the saved passenger profile and call bookFlight now — do NOT ask for any details.`);
  });

  // ── Callback: cancel booking ──────────────────────────
  bot.callbackQuery("cancel_book", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply("No problem. Tap another flight above, or tell me a new route to search.");
  });

  // ── All text messages → AI ─────────────────────────────
  bot.on("message:text", async (ctx) => {
    if (ctx.session.processing) {
      await ctx.reply("Still on it — hang tight.");
      return;
    }
    await runAI(ctx, ctx.message.text);
  });

  // ── Helper: progress updater ────────────────────────────
  async function createProgressUpdater(ctx: BotContext) {
    let messageId: number | undefined;
    let chatId: number | undefined;
    let lastText = "";

    return {
      async send(text: string) {
        if (text === lastText) return;
        lastText = text;
        if (messageId && chatId) {
          await ctx.api.editMessageText(chatId, messageId, text).catch(() => {});
        } else {
          const msg = await ctx.reply(text);
          messageId = msg.message_id;
          chatId = msg.chat.id;
        }
      },
      async remove() {
        if (messageId && chatId) {
          await ctx.api.deleteMessage(chatId, messageId).catch(() => {});
        }
      }
    };
  }

  // ── Helper: run AI with all UX capabilities ─────────────
  async function runAI(ctx: BotContext, userText: string) {
  // Ensure profile is loaded from DB if not in session
  if (!ctx.session.profile && ctx.from) {
    await touchUser(ctx.from.id);
    const saved = await dbGetProfile(ctx.from.id);
    if (saved) ctx.session.profile = saved;
  }

  ctx.session.processing = true;
  ctx.session.lastSeenAt = Date.now();

  try {
    // Verification code callback: ask user via Telegram, wait for reply
    const onVerificationCode = async (_email: string): Promise<string> => {
      await ctx.reply("Please enter the latest code to continue your booking.");
      ctx.session.processing = false; // Allow user to reply

      return new Promise<string>((resolve) => {
        let resolved = false;
        const handler = (msgCtx: any) => {
          if (resolved) return;
          if (msgCtx.from?.id === ctx.from?.id && msgCtx.message?.text) {
            const code = msgCtx.message.text.trim();
            if (/^\d{4,8}$/.test(code)) {
              resolved = true;
              ctx.session.processing = true;
              resolve(code);
            }
          }
        };
        bot.on("message:text", handler as any);
      });
    };

    // Progress updater for narration
    const progress = await createProgressUpdater(ctx);

    const result = await handleMessage(
      userText,
      ctx.session.history,
      ctx.session.searchResults,
      ctx.session.selectedFlightIndex,
      ctx.session.profile,
      ctx.session.onboarding,
      ctx.session.lastSearchRequest,
      onVerificationCode,
      (step: string) => progress.send(step)
    );

    // Remove progress message — real results follow
    await progress.remove();

    ctx.session.history = result.updatedHistory;
    if (result.searchResults) ctx.session.searchResults = result.searchResults;
    if (result.selectedFlightIndex !== undefined) ctx.session.selectedFlightIndex = result.selectedFlightIndex;
    if (result.lastSearchRequest) ctx.session.lastSearchRequest = result.lastSearchRequest;

    // Track search count and reset failure counter on success
    if (result.newSearch && result.searchResults && result.searchResults.length > 0) {
      ctx.session.searchCount++;
      ctx.session.failedAttempts = 0;
      ctx.session.isFirstVisit = false;
    }

    if (result.profile) {
      ctx.session.profile = result.profile;
      ctx.session.onboarding = false;
      await dbSaveProfile(ctx.from!.id, result.profile);
      console.log(`[profile] Saved profile for ${ctx.from!.id}`);
    }

    if (ctx.from && result.bookingId && result.bookingStatus && result.bookingSummary && ctx.session.profile) {
      await saveBookingAttempt({
        telegramId: ctx.from.id,
        profile: ctx.session.profile,
        selectedFlight: result.bookedFlight,
        providerBookingId: result.bookingId,
        status: result.bookingStatus,
        paymentUrl: result.paymentUrl,
        amount: result.bookingSummary.price,
        currency: result.bookingSummary.currency,
        summary: result.bookingSummary,
        bankTransfers: result.bankTransfers,
        customerEmail: ctx.session.profile.email,
        bookingContactEmail: result.contactContext?.bookingContactEmail,
        verificationMode: result.contactContext?.verificationMode,
        verificationStatus: result.contactContext?.verificationStatus
      });
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
      await ctx.reply("Tap a flight to see details:", { reply_markup: keyboard });

      // First-journey hint — distributed onboarding
      if (ctx.session.searchCount === 1) {
        await ctx.reply(`💡 Tip: Try "search next week" to compare prices across multiple days.`);
      }
    } else {
      await ctx.reply(result.reply || "I didn't catch that. Try something like \"flights from Lagos to Dubai on Friday\".");
    }

  } catch (error) {
    console.error("AI handler error:", error);
    ctx.session.failedAttempts++;

    // Localized error recovery with struggle detection
    let reply: string;
    if (ctx.session.failedAttempts >= 3) {
      // Proactive help — skip explanation, offer alternative
      reply = `This isn't working as expected. Here are some things that usually help:\n\n` +
        `• Try a different route or date\n` +
        `• Use city names like "Lagos" instead of codes\n` +
        `• Use /cancel to start fresh\n\n` +
        `Or just tell me what you're trying to do and I'll find another way.`;
      ctx.session.failedAttempts = 0; // reset after proactive help
    } else if (ctx.session.failedAttempts === 2) {
      // Second failure — shorter, more direct
      reply = `Still having trouble. Try a different date or route, or use /cancel to start over.`;
    } else {
      // First failure — explain + next step
      const raw = error instanceof Error ? error.message : "";
      if (raw.includes("No flight results") || raw.includes("search")) {
        reply = `Couldn't find flights for that search. Try different dates — weekdays often have more options.`;
      } else if (raw.includes("Booking") || raw.includes("booking")) {
        reply = `The booking didn't go through. This can happen when flights sell out quickly. Try selecting the flight again.`;
      } else {
        reply = `Something unexpected happened. Try again, or use /cancel to start fresh.`;
      }
    }
    await ctx.reply(reply);
  } finally {
    ctx.session.processing = false;
  }
  }

  return bot;
}

function formatShortDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`);
  const day = d.getDate();
  const month = d.toLocaleString("en-US", { month: "short" });
  const weekday = d.toLocaleString("en-US", { weekday: "short" });
  return `${weekday} ${day} ${month}`;
}
