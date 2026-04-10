import { generateText, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { searchFlightsApi } from "../services/wakanow/api-search.js";
import { bookFlightApi } from "../services/wakanow/api-book.js";
import type { FlightSearchResult } from "../schemas/flight-search.js";
import type { PassengerProfile } from "./session.js";

type Message = { role: "user" | "assistant" | "system"; content: string };

const TODAY = () => new Date().toISOString().split("T")[0];

function buildSystemPrompt(profile: PassengerProfile | undefined, onboarding: boolean): string {
  let prompt = `You are SkyPadi, a flight booking assistant on Telegram for Wakanow (Nigerian travel platform).

Today's date: ${TODAY()}

Guidelines:
- Keep responses concise — this is a chat, not an email
- Prices are in Nigerian Naira (NGN/₦)`;

  if (onboarding) {
    prompt += `

CURRENT MODE: Onboarding — collecting passenger profile.
Ask the user for their details conversationally: title (Mr/Ms/Mrs/Miss/Dr), full name (first, middle if any, last), date of birth (YYYY-MM-DD), gender (Male/Female), phone number, and email.
You can ask for several at once. Once you have ALL details, call the saveProfile tool.
Don't ask about flights yet — just get the profile set up first.`;
  } else {
    prompt += `

Your capabilities:
1. Search flights — use searchFlights when a user wants to find flights
2. Book flights — use bookFlight when a user selects a flight

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
  onboarding: boolean
): Promise<{
  reply: string;
  updatedHistory: Message[];
  searchResults?: FlightSearchResult[];
  selectedFlightIndex?: number;
  newSearch?: boolean;
  profile?: PassengerProfile;
  paymentUrl?: string;
  bankTransfers?: import("../services/wakanow/api-book.js").BankTransferDetails[];
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
  let bankTransfers: import("../services/wakanow/api-book.js").BankTransferDetails[] | undefined;

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
          const result = await searchFlightsApi({
            origin,
            destination,
            departureDate,
            returnDate,
            maxResults: 10
          });
          newSearchResults = result.results;
          didNewSearch = true;
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
          const CONCURRENCY = 2; // Wakanow throttles beyond 2 concurrent requests

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
            return { error: "No passenger profile found. Ask the user for their details." };
          }
          if (!newSearchResults || newSearchResults.length === 0) {
            return { error: "No search results. Search for flights first." };
          }

          const idx = flightIndex - 1;
          if (idx < 0 || idx >= newSearchResults.length) {
            return { error: `Flight ${flightIndex} not found.` };
          }

          newSelectedIndex = idx;
          const flight = newSearchResults[idx];

          if (!flight.flightId || !flight.searchKey) {
            return { error: "Flight missing booking data. Try searching again." };
          }

          console.log(`[bookFlight] Booking flight ${flightIndex}: ${flight.airline} via API`);

          const bookResult = await bookFlightApi({
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
            }
          });

          paymentUrl = bookResult.paymentUrl;
          bankTransfers = bookResult.bankTransfers;

          let bankInfo = "";
          if (bookResult.bankTransfers && bookResult.bankTransfers.length > 0) {
            bankInfo = "\n\nBank Transfer Options:";
            for (const bt of bookResult.bankTransfers) {
              bankInfo += `\n\n${bt.bank}\nAccount: ${bt.accountNumber}\nBeneficiary: ${bt.beneficiary}`;
            }
            bankInfo += `\n\nExpires in: ${bookResult.bankTransfers[0].expiresIn}`;
            bankInfo += `\nNote: ${bookResult.bankTransfers[0].note}`;
          }

          return {
            success: true,
            bookingId: bookResult.bookingId,
            status: bookResult.status,
            paymentUrl: bookResult.paymentUrl,
            bankTransfers: bookResult.bankTransfers,
            summary: `${bookResult.flightSummary.airline} ${bookResult.flightSummary.departure}→${bookResult.flightSummary.arrival} ₦${bookResult.flightSummary.price.toLocaleString()}`,
            message: `Booking confirmed! Booking ID: ${bookResult.bookingId}. Transfer exactly ₦${bookResult.flightSummary.price.toLocaleString()} to complete payment.${bankInfo}`
          };
        }
      }
    },
    toolChoice: "auto",
    stopWhen: stepCountIs(5)
  });

  const assistantReply = result.text || "Sorry, I couldn't process that. Try again.";

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
    bankTransfers
  };
}
