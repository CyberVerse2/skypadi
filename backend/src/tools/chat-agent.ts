import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";

import { normalizeAirportCode } from "../domain/flight/airport-catalog";
import type { ChatAction, DecideChatActionInput } from "./chat-tool.types";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const airportCodeSchema = z.string().regex(/^[A-Z]{3}$/);
const searchFlightsInputSchema = z
  .object({
    origin: airportCodeSchema,
    destination: airportCodeSchema,
    departureDate: dateSchema,
    departureWindow: z.enum(["morning", "afternoon", "evening", "anytime"]).optional(),
    returnDate: dateSchema.optional(),
    adults: z.number().int().positive(),
  })
  .superRefine((input, context) => {
    if (input.returnDate && input.returnDate < input.departureDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "returnDate must be on or after departureDate",
        path: ["returnDate"],
      });
    }
  });

const collectTripDetailsInputSchema = z.object({
  origin: airportCodeSchema.optional(),
  destination: airportCodeSchema.optional(),
  departureDate: dateSchema.optional(),
  departureWindow: z.enum(["morning", "afternoon", "evening", "anytime"]).optional(),
  returnDate: dateSchema.optional(),
  adults: z.number().int().positive().optional(),
});

const sendControlledReplyInputSchema = z.object({
  key: z.literal("skypadi_intro"),
});

const legacyChatActionSchema = z.union([
  z.object({
    type: z.literal("reply"),
    message: z.string().trim().min(1),
  }),
  z.discriminatedUnion("tool", [
    z.object({
      type: z.literal("tool"),
      tool: z.literal("searchFlights"),
      input: searchFlightsInputSchema,
    }),
    z.object({
      type: z.literal("tool"),
      tool: z.literal("collectTripDetails"),
      input: collectTripDetailsInputSchema,
    }),
    z.object({
      type: z.literal("tool"),
      tool: z.literal("startNewTrip"),
      input: collectTripDetailsInputSchema,
    }),
    z.object({
      type: z.literal("tool"),
      tool: z.literal("sendControlledReply"),
      input: sendControlledReplyInputSchema,
    }),
    z.object({
      type: z.literal("tool"),
      tool: z.literal("startBookingJob"),
      input: z.object({
        selectedFlightOptionId: z.string().uuid(),
      }),
    }),
  ]),
]);

const modelSearchFlightsInputSchema = z.object({
  origin: airportCodeSchema,
  destination: airportCodeSchema,
  departureDate: dateSchema,
  departureWindow: z.enum(["morning", "afternoon", "evening", "anytime"]).nullable(),
  returnDate: dateSchema.nullable(),
  adults: z.number().int().positive(),
});

const modelCollectTripDetailsInputSchema = z.object({
  origin: airportCodeSchema.nullable(),
  destination: airportCodeSchema.nullable(),
  departureDate: dateSchema.nullable(),
  departureWindow: z.enum(["morning", "afternoon", "evening", "anytime"]).nullable(),
  returnDate: dateSchema.nullable(),
  adults: z.number().int().positive().nullable(),
});

const modelSendControlledReplyInputSchema = z.object({
  key: z.literal("skypadi_intro"),
});

const chatActionResponseSchema = z.object({
  action: z.enum(["answerSideQuestion", "searchFlights", "collectTripDetails", "startNewTrip", "sendControlledReply", "startBookingJob"]),
  message: z.string().trim().nullable(),
  searchFlightsInput: modelSearchFlightsInputSchema.nullable(),
  collectTripDetailsInput: modelCollectTripDetailsInputSchema.nullable(),
  sendControlledReplyInput: modelSendControlledReplyInputSchema.nullable(),
  startBookingJobInput: z
    .object({
      selectedFlightOptionId: z.string().uuid(),
    })
    .nullable(),
});

export type ChatModel = (input: DecideChatActionInput) => Promise<unknown>;

export async function decideChatActionWithModel(
  model: ChatModel,
  input: DecideChatActionInput
): Promise<ChatAction> {
  const parsed = parseChatAction(await model(input));
  if (parsed.type === "reply") {
    return { type: "reply", message: trimToThreeSentences(parsed.message) };
  }
  return parsed;
}

export function createOpenAIChatModel(input: { apiKey: string; model: string }): ChatModel {
  const openai = createOpenAI({ apiKey: input.apiKey });
  return async (decisionInput) => {
    const result = await generateObject({
      model: openai.chat(input.model),
      schema: chatActionResponseSchema,
      prompt: buildPrompt(decisionInput),
      maxRetries: 0,
    });
    return parseChatAction(result.object);
  };
}

function parseChatAction(value: unknown): ChatAction {
  const legacy = legacyChatActionSchema.safeParse(value);
  if (legacy.success) return legacy.data;

  const parsed = chatActionResponseSchema.parse(value);
  if (parsed.action === "answerSideQuestion") {
    if (!parsed.message) {
      throw new Error("answerSideQuestion action requires a message");
    }
    return { type: "reply", message: parsed.message };
  }

  if (parsed.action === "searchFlights") {
    if (!parsed.searchFlightsInput) {
      throw new Error("searchFlights action requires searchFlightsInput");
    }
    return {
      type: "tool",
      tool: "searchFlights",
      input: {
        origin: normalizeAirportCode(parsed.searchFlightsInput.origin),
        destination: normalizeAirportCode(parsed.searchFlightsInput.destination),
        departureDate: parsed.searchFlightsInput.departureDate,
        ...(parsed.searchFlightsInput.departureWindow ? { departureWindow: parsed.searchFlightsInput.departureWindow } : {}),
        ...(parsed.searchFlightsInput.returnDate ? { returnDate: parsed.searchFlightsInput.returnDate } : {}),
        adults: parsed.searchFlightsInput.adults,
      },
    };
  }

  if (parsed.action === "collectTripDetails" || parsed.action === "startNewTrip") {
    if (!parsed.collectTripDetailsInput) {
      throw new Error(`${parsed.action} action requires collectTripDetailsInput`);
    }
    return {
      type: "tool",
      tool: parsed.action,
      input: {
        ...(parsed.collectTripDetailsInput.origin ? { origin: normalizeAirportCode(parsed.collectTripDetailsInput.origin) } : {}),
        ...(parsed.collectTripDetailsInput.destination ? { destination: normalizeAirportCode(parsed.collectTripDetailsInput.destination) } : {}),
        ...(parsed.collectTripDetailsInput.departureDate ? { departureDate: parsed.collectTripDetailsInput.departureDate } : {}),
        ...(parsed.collectTripDetailsInput.departureWindow ? { departureWindow: parsed.collectTripDetailsInput.departureWindow } : {}),
        ...(parsed.collectTripDetailsInput.returnDate ? { returnDate: parsed.collectTripDetailsInput.returnDate } : {}),
        ...(parsed.collectTripDetailsInput.adults ? { adults: parsed.collectTripDetailsInput.adults } : {}),
      },
    };
  }

  if (parsed.action === "sendControlledReply") {
    if (!parsed.sendControlledReplyInput) {
      throw new Error("sendControlledReply action requires sendControlledReplyInput");
    }
    return { type: "tool", tool: "sendControlledReply", input: parsed.sendControlledReplyInput };
  }

  if (!parsed.startBookingJobInput) {
    throw new Error("startBookingJob action requires startBookingJobInput");
  }
  return { type: "tool", tool: "startBookingJob", input: parsed.startBookingJobInput };
}

function buildPrompt(input: DecideChatActionInput): string {
  return [
    "You are Skypadi, a WhatsApp flight booking assistant.",
    "Keep answerSideQuestion messages to at most three short sentences.",
    "Do not write workflow prompts yourself.",
    "Return action=answerSideQuestion only for side questions or general chat.",
    "Never use action=answerSideQuestion to ask for origin, destination, travel date, departure window, trip type, return date, or passenger count.",
    "Return action=sendControlledReply with key=skypadi_intro for Skypadi capability, product, about, or help questions.",
    "Return action=startNewTrip with collectTripDetailsInput when the user asks to book, find, search, get, need, or want a new flight; include any trip details provided in the same message and ignore stale currentDraft values.",
    "Return action=collectTripDetails with collectTripDetailsInput when the user provides, confirms, corrects, or needs the next trip-detail prompt; use null fields when no new trip detail was provided.",
    "Return action=searchFlights with searchFlightsInput only when origin, destination, departure date, and adult count are known and no trip details need to be merged first.",
    "Return action=startBookingJob with startBookingJobInput only when the user clearly selected a flight option by ID already shown by the app.",
    "Do not call booking tools for side questions.",
    `Current date: ${input.now.toISOString().slice(0, 10)}`,
    `Context: ${JSON.stringify(input.context)}`,
    `User message: ${input.userText}`,
  ].join("\n");
}

function trimToThreeSentences(message: string): string {
  const sentences = message
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);
  return sentences.slice(0, 3).join(" ");
}
