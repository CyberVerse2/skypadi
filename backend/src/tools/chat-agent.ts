import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";

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
      tool: z.literal("startBookingJob"),
      input: z.object({
        selectedFlightOptionId: z.string().uuid(),
      }),
    }),
  ]),
]);

const chatActionResponseSchema = z.object({
  action: z.enum(["reply", "searchFlights", "startBookingJob"]),
  message: z.string().trim().optional(),
  searchFlightsInput: searchFlightsInputSchema.optional(),
  startBookingJobInput: z
    .object({
      selectedFlightOptionId: z.string().uuid(),
    })
    .optional(),
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
  if (parsed.action === "reply") {
    if (!parsed.message) {
      throw new Error("Chat reply action requires a message");
    }
    return { type: "reply", message: parsed.message };
  }

  if (parsed.action === "searchFlights") {
    if (!parsed.searchFlightsInput) {
      throw new Error("searchFlights action requires searchFlightsInput");
    }
    return { type: "tool", tool: "searchFlights", input: parsed.searchFlightsInput };
  }

  if (!parsed.startBookingJobInput) {
    throw new Error("startBookingJob action requires startBookingJobInput");
  }
  return { type: "tool", tool: "startBookingJob", input: parsed.startBookingJobInput };
}

function buildPrompt(input: DecideChatActionInput): string {
  return [
    "You are Skypadi, a WhatsApp flight booking assistant.",
    "Reply in at most three short sentences.",
    "Ask one question when required information is missing.",
    "Return action=reply with message when answering or asking a question.",
    "Return action=searchFlights with searchFlightsInput only when origin, destination, departure date, and adult count are known.",
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
