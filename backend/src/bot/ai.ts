import { generateText, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { searchFlightsApi } from "../services/wakanow/api-search.js";
import { bookFlightApi } from "../services/wakanow/api-book.js";
import type { FlightSearchResult } from "../schemas/flight-search.js";
import type { PassengerProfile, LastSearchRequest } from "./session.js";
import type {
  BankTransferDetails,
  BookingContactContext,
  BookingFlightSummary
} from "../schemas/booking-contract.js";

type Message = { role: "user" | "assistant" | "system"; content: string };

const TODAY = () => new Date().toISOString().split("T")[0];

function summarizeBookingFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const message = raw.toLowerCase();

  if (message.includes("agentmail") || message.includes("verification code required")) {
    return "The booking paused at verification, but our AgentMail auto-resolver did not complete it. Please try again while we check the verification pipeline.";
  }
  if (message.includes("anti-bot") || message.includes("challenge")) {
    return "The airline blocked this booking attempt before it could complete. Please tap the same flight again to retry.";
  }
  if (message.includes("sold out") || message.includes("no longer available")) {
    return "That flight is no longer available. Please search again or choose another option.";
  }
  if (message.includes("validation")) {
    return "The airline rejected some booking details during submission. Please try again while we inspect the validation step.";
  }
  if (message.includes("did not commit") || message.includes("customer-info")) {
    return "The booking did not complete on the airline side. Please tap the same flight again to retry, or choose a different option.";
  }

  return "The booking didn't go through. Please tap the same flight again to retry, or choose a different option.";
}

function buildSystemPrompt(profile: PassengerProfile | undefined, onboarding: boolean): string {
  let prompt = `You are SkyPadi, our flight booking assistant on Telegram.

Today's date: ${TODAY()}

Guidelines:
- Keep responses concise — this is a chat, not an email
- Prices are in Nigerian Naira (NGN/₦)

## User Experience

NARRATION: When you trigger a search or booking, the app shows live progress updates. Don't narrate steps yourself — just confirm what you're doing in one short line ("Searching Lagos → Dubai for April 25...") and let the app handle progress.

CONTEXT: After showing any result, add one line that interprets what it means. Then suggest one thing the user can do to get better results.
Example: "These are all connecting flights. For a direct option, try departing from Abuja instead."

FIRST-TIME USERS: If the user has no profile yet, welcome them warmly but let them search flights immediately. Only ask for profile details when they want to book. Don't front-load onboarding.

ERRORS: Never show raw errors or technical details. Explain what went wrong plainly, give the most likely reason, and offer a specific next step.
Bad: "SearchError: No flight results found. {requestKey: abc123}"
Good: "No flights found for Lagos → London on that date. Try a nearby date — Tuesdays and Wednesdays often have more options."

STRUGGLE: If the user has tried the same thing twice and failed, skip the explanation and go straight to a fix. After 3 failures, proactively name what they're trying to do and suggest a different approach.

AGENCY: After every recommendation, give the user one thing they can do to influence the next result.
Example: "Flexible on dates? Try 'search next week' to find the cheapest day."`;

  prompt += `

CONTACT DETAILS: Treat the saved passenger profile as the customer's contact details. Do not mention internal verification channels, shared inboxes, or any provider-side contact routing. If a booking needs verification, describe it neutrally as a booking verification step.`;


  if (onboarding) {
    prompt += `

CURRENT MODE: Collecting passenger profile for booking.
Ask the user for their details conversationally: title (Mr/Ms/Mrs/Miss/Dr), full name (first, middle if any, last), date of birth (YYYY-MM-DD), gender (Male/Female), phone number, and email.
You can ask for several at once. Once you have ALL details, call the saveProfile tool.`;
  } else {
    prompt += `

Your capabilities:
1. Search flights — use searchFlights when a user wants to find flights
2. Book flights — use bookFlight when a user selects a flight (requires profile)

Search guidelines:
- When the user mentions a destination and timeframe, search immediately
- If no departure city is given, ask the user where they're flying from
- For specific dates like "next Friday", "tomorrow", "April 25", calculate the YYYY-MM-DD and use searchFlights
- For date ranges like "next week", "this weekend", use searchFlightsMultiDay with all dates in that range (e.g. "next week" = Mon-Sun of next week, "this weekend" = Sat+Sun). It searches all days in parallel and returns cheapest options
- Default to one-way unless the user mentions return/round trip
- After a search, DON'T list the flights in your text — the app displays them as buttons. Just say something brief like "Found X flights" and the user will tap one

Booking guidelines:
- When the user selects a flight, book it immediately using their saved profile — don't ask for details again
- Just confirm what you're booking and proceed`;

    if (profile) {
      prompt += `

Saved passenger profile:
- Title: ${profile.title}
- Name: ${profile.firstName}${profile.middleName ? ` ${profile.middleName}` : ""} ${profile.lastName}
- DOB: ${profile.dateOfBirth}
- Gender: ${profile.gender}
- Phone: ${profile.phone}
- Email: ${profile.email}`;
    }
  }

  return prompt;
}

export async function handleMessage(
  userMessage: string,
  conversationHistory: Message[],
  searchResults: FlightSearchResult[] | undefined,
  selectedFlightIndex: number | undefined,
  profile: PassengerProfile | undefined,
  onboarding: boolean,
  lastSearchRequest?: LastSearchRequest,
  onProgress?: (step: string) => Promise<void>
): Promise<{
  reply: string;
  updatedHistory: Message[];
  searchResults?: FlightSearchResult[];
  selectedFlightIndex?: number;
  newSearch?: boolean;
  profile?: PassengerProfile;
  lastSearchRequest?: LastSearchRequest;
  paymentUrl?: string;
  bankTransfers?: BankTransferDetails[];
  contactContext?: BookingContactContext;
  bookingId?: string;
  bookingStatus?: string;
  bookingSummary?: BookingFlightSummary;
  bookedFlight?: FlightSearchResult;
  debugScreenshots?: Buffer[];
}> {
  let systemContent = buildSystemPrompt(profile, onboarding);

  if (searchResults && searchResults.length > 0 && !onboarding) {
    const resultsContext = searchResults
      .map((f, i) => `${i + 1}. ${f.airline} ${f.departureTime}→${f.arrivalTime} ${f.priceText} (${f.stops})`)
      .join("\n");
    systemContent += `\n\nCurrent search results:\n${resultsContext}\nDeeplink: ${searchResults[0].deeplink}`;
  }

  const messages: Array<{ role: "user" | "assistant" | "system"; content: string }> = [
    { role: "system", content: systemContent },
    ...conversationHistory,
    { role: "user", content: userMessage }
  ];

  let newSearchResults = searchResults;
  let newSelectedIndex = selectedFlightIndex;
  let didNewSearch = false;
  let savedProfile: PassengerProfile | undefined;
  let paymentUrl: string | undefined;
  let bankTransfers: BankTransferDetails[] | undefined;
  let contactContext: BookingContactContext | undefined;
  let bookingId: string | undefined;
  let bookingStatus: string | undefined;
  let bookingSummary: BookingFlightSummary | undefined;
  let bookedFlight: FlightSearchResult | undefined;
  let newLastSearchRequest = lastSearchRequest;
  let debugScreenshots: Buffer[] | undefined;

  const result = await generateText({
    model: openai.chat("gpt-5.4-mini"),
    messages,
    tools: {
      saveProfile: {
        description: "Save the user's passenger profile after collecting all details during onboarding",
        inputSchema: z.object({
          title: z.enum(["Mr", "Ms", "Mrs", "Miss", "Dr"]),
          firstName: z.string().min(2),
          lastName: z.string().min(2),
          middleName: z.string().optional().describe("Middle name (optional)"),
          dateOfBirth: z.string().describe("YYYY-MM-DD format"),
          gender: z.enum(["Male", "Female"]),
          phone: z.string().min(7),
          email: z.string().email()
        }),
        execute: async (input) => {
          savedProfile = input;
          return { success: true, message: "Profile saved successfully" };
        }
      },
      searchFlights: {
        description: "Search for flights on a specific date",
        inputSchema: z.object({
          origin: z.string().describe("Departure city name (e.g. Lagos, Abuja)"),
          destination: z.string().describe("Arrival city name"),
          departureDate: z.string().describe("Departure date in YYYY-MM-DD format"),
          returnDate: z.string().optional().describe("Return date for round trips")
        }),
        execute: async ({ origin, destination, departureDate, returnDate }) => {
          console.log(`[searchFlights] ${origin} → ${destination} on ${departureDate}`);
          await onProgress?.(`🔍 Searching ${origin} → ${destination} for ${departureDate}...`);
          try {
            const result = await searchFlightsApi({
              origin,
              destination,
              departureDate,
              returnDate,
              maxResults: 10
            });
            console.log(`[searchFlights] Found ${result.resultCount} flights`);
            await onProgress?.(`✅ Found ${result.resultCount} flights — preparing results...`);
            newSearchResults = result.results;
            didNewSearch = true;
            newLastSearchRequest = { origin, destination, departureDate, returnDate, searchedAt: Date.now() };
            return {
              count: result.resultCount,
              flights: result.results.map((f, i) => ({
                index: i + 1,
                airline: f.airline,
                departure: f.departureTime,
                arrival: f.arrivalTime,
                duration: f.duration,
                stops: f.stops,
                price: f.priceText
              }))
            };
          } catch (e: any) {
            console.error(`[searchFlights] Failed: ${e.message}`, e.cause ?? "");
            return { error: `No flights found for ${origin} → ${destination} on ${departureDate}. Try a different date — Tuesdays and Wednesdays often have more options.` };
          }
        }
      },
      searchFlightsMultiDay: {
        description: "Search flights across multiple dates (e.g. an entire week). Use this when the user says 'next week', 'this weekend', or any date range. Searches all dates in parallel and returns the cheapest options across all days.",
        inputSchema: z.object({
          origin: z.string().describe("Departure city name"),
          destination: z.string().describe("Arrival city name"),
          dates: z.array(z.string()).describe("Array of dates in YYYY-MM-DD format to search across")
        }),
        execute: async ({ origin, destination, dates }) => {
          const CONCURRENCY = 2; // Current provider throttles beyond 2 concurrent requests
          await onProgress?.(`🔍 Searching ${origin} → ${destination} across ${dates.length} dates... (usually ~${Math.ceil(dates.length * 5)}s)`);

          // Process dates in batches to avoid rate limiting
          const allResults: any[] = [];
          for (let i = 0; i < dates.length; i += CONCURRENCY) {
            const batch = dates.slice(i, i + CONCURRENCY);
            const batchResults = await Promise.all(
              batch.map((date: string) =>
                searchFlightsApi({ origin, destination, departureDate: date, maxResults: 10 })
                  .then((r) => r.results.map((f) => ({ ...f, date })))
                  .catch(() => [] as any[])
              )
            );
            allResults.push(...batchResults.flat());
            const searched = Math.min(i + CONCURRENCY, dates.length);
            await onProgress?.(`🔍 Checked ${searched}/${dates.length} dates — ${allResults.length} flights so far...`);
          }

          // Sort by price (extract numeric value)
          allResults.sort((a, b) => {
            const priceA = parseFloat((a.priceText ?? "0").replace(/[^\d.]/g, ""));
            const priceB = parseFloat((b.priceText ?? "0").replace(/[^\d.]/g, ""));
            return priceA - priceB;
          });

          const top = allResults.slice(0, 15);
          newSearchResults = top;
          didNewSearch = true;

          return {
            totalFound: allResults.length,
            datesSearched: dates,
            flights: top.map((f, i) => ({
              index: i + 1,
              date: (f as any).date,
              airline: f.airline,
              departure: f.departureTime,
              arrival: f.arrivalTime,
              duration: f.duration,
              stops: f.stops,
              price: f.priceText
            }))
          };
        }
      },
      bookFlight: {
        description: "Book a selected flight using the saved passenger profile",
        inputSchema: z.object({
          flightIndex: z.number().describe("Flight number from search results (1-based)")
        }),
        execute: async ({ flightIndex }) => {
          const p = savedProfile ?? profile;
          if (!p) {
            return { error: "I need your details before booking. Could you share your name, date of birth, gender, phone, and email?" };
          }
          if (!newSearchResults || newSearchResults.length === 0) {
            return { error: "No flights loaded yet. Search for flights first, then pick one to book." };
          }

          const idx = flightIndex - 1;
          if (idx < 0 || idx >= newSearchResults.length) {
            return { error: `Flight ${flightIndex} isn't in the current results. Tap one of the flight buttons above to select it.` };
          }

          newSelectedIndex = idx;
          const flight = newSearchResults[idx];

          if (!flight.flightId || !flight.searchKey) {
            return { error: "This flight can't be booked directly. Try searching again — the refreshed results will have full booking data." };
          }

          // Re-search if results are older than 5 minutes to get a fresh deeplink
          const STALE_MS = 5 * 60 * 1000;
          if (newLastSearchRequest && (Date.now() - newLastSearchRequest.searchedAt) > STALE_MS) {
            console.log(`[bookFlight] Search results are stale (${Math.round((Date.now() - newLastSearchRequest.searchedAt) / 1000)}s old), re-searching...`);
            await onProgress?.(`🔄 Refreshing flight availability before booking...`);
            try {
              const freshResult = await searchFlightsApi({
                origin: newLastSearchRequest.origin,
                destination: newLastSearchRequest.destination,
                departureDate: newLastSearchRequest.departureDate,
                returnDate: newLastSearchRequest.returnDate,
                maxResults: 10
              });
              console.log(`[bookFlight] Re-search found ${freshResult.resultCount} flights`);
              newSearchResults = freshResult.results;
              newLastSearchRequest = { ...newLastSearchRequest, searchedAt: Date.now() };
              // Find the same flight in fresh results by airline + time
              const freshIdx = newSearchResults.findIndex(f =>
                f.airline === flight.airline && f.departureTime === flight.departureTime && f.arrivalTime === flight.arrivalTime
              );
              if (freshIdx === -1) {
                return { error: "That flight is no longer available — it may have sold out. Search again to see what's current." };
              }
              const freshFlight = newSearchResults[freshIdx];
              if (!freshFlight.flightId || !freshFlight.searchKey) {
                return { error: "The refreshed flight can't be booked directly. Try a new search." };
              }
              // Use fresh flight data
              Object.assign(flight, freshFlight);
              newSelectedIndex = freshIdx;
              didNewSearch = true;
            } catch (e: any) {
              console.log(`[bookFlight] Re-search failed: ${e.message}, proceeding with stale data`);
            }
          }

          console.log(`[bookFlight] Booking flight ${flightIndex}: ${flight.airline} via API`);
          await onProgress?.(`✈️ Booking ${flight.airline} ${flight.departureTime}→${flight.arrivalTime}...\n⏳ Filling passenger details... (usually ~60s)`);

          let bookResult;
          try {
            bookResult = await bookFlightApi({
              searchKey: flight.searchKey,
              flightId: flight.flightId,
              deeplink: flight.deeplink,
              passenger: {
                title: p.title as "Mr" | "Ms" | "Mrs" | "Miss" | "Dr",
                firstName: p.firstName,
                lastName: p.lastName,
                middleName: p.middleName,
                dateOfBirth: p.dateOfBirth,
                nationality: "Nigerian",
                gender: p.gender as "Male" | "Female",
              phone: p.phone,
              email: p.email
            },
              onProgress
            });
          } catch (bookErr: any) {
            if (bookErr.screenshots?.length) debugScreenshots = bookErr.screenshots;
            console.error("[bookFlight] Booking failed:", bookErr);
            return { error: summarizeBookingFailure(bookErr) };
          }

          paymentUrl = bookResult.paymentUrl;
          bankTransfers = bookResult.bankTransfers;
          contactContext = bookResult.contactContext;
          bookingId = bookResult.bookingId;
          bookingStatus = bookResult.status;
          bookingSummary = bookResult.flightSummary;
          bookedFlight = flight;

          let bankInfo = "";
          if (bookResult.bankTransfers && bookResult.bankTransfers.length > 0) {
            bankInfo = "\n\nBank Transfer Options:";
            for (const bt of bookResult.bankTransfers) {
              bankInfo += `\n\n${bt.bank}\nAccount: ${bt.accountNumber}\nBeneficiary: ${bt.beneficiary}`;
            }
            bankInfo += `\n\nExpires in: ${bookResult.bankTransfers[0].expiresIn}`;
            bankInfo += `\nNote: ${bookResult.bankTransfers[0].note}`;
          }

          const confirmationNote = bookResult.confirmationEmail
            ? `\n\n✅ Booking confirmation received — "${bookResult.confirmationEmail.subject}"`
            : "";

          return {
            success: true,
            bookingId: bookResult.bookingId,
            status: bookResult.status,
            paymentUrl: bookResult.paymentUrl,
            bankTransfers: bookResult.bankTransfers,
            confirmationEmail: bookResult.confirmationEmail,
            summary: `${bookResult.flightSummary.airline} ${bookResult.flightSummary.departure}→${bookResult.flightSummary.arrival} ₦${bookResult.flightSummary.price.toLocaleString()}`,
            message: `Booking confirmed! Booking ID: ${bookResult.bookingId}. Transfer exactly ₦${bookResult.flightSummary.price.toLocaleString()} to complete payment.${bankInfo}${confirmationNote}`
          };
        }
      }
    },
    toolChoice: "auto",
    stopWhen: stepCountIs(5)
  });

  const assistantReply = result.text || "I didn't quite get that. Try telling me where you want to fly — for example, \"Lagos to Dubai next Friday\".";

  const updatedHistory: Message[] = [
    ...conversationHistory,
    { role: "user", content: userMessage },
    { role: "assistant", content: assistantReply }
  ];

  return {
    reply: assistantReply,
    updatedHistory: updatedHistory.slice(-20),
    searchResults: newSearchResults,
    selectedFlightIndex: newSelectedIndex,
    newSearch: didNewSearch,
    profile: savedProfile,
    paymentUrl,
    bankTransfers,
    contactContext,
    bookingId,
    bookingStatus,
    bookingSummary,
    bookedFlight,
    lastSearchRequest: newLastSearchRequest,
    debugScreenshots
  };
}
