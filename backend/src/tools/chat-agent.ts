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

const chatActionSchema = z.union([
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

export type ChatModel = (input: DecideChatActionInput) => Promise<unknown>;

export async function decideChatActionWithModel(
  model: ChatModel,
  input: DecideChatActionInput
): Promise<ChatAction> {
  const parsed = chatActionSchema.parse(await model(input));
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
      schema: chatActionSchema,
      prompt: buildPrompt(decisionInput),
      maxRetries: 0,
    });
    return result.object;
  };
}

function buildPrompt(input: DecideChatActionInput): string {
  return [
    "You are Skypadi, a WhatsApp flight booking assistant.",
    "Reply in at most three short sentences.",
    "Ask one question when required information is missing.",
    "Use searchFlights only when origin, destination, departure date, and adult count are known.",
    "Use startBookingJob only when the user clearly selected a flight option by ID already shown by the app.",
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
