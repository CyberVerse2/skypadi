import type { ChatContext } from "../../tools/chat-tool.types";
import type { UiIntent } from "./whatsapp.types";

export const SKYPADI_ONBOARDING_MESSAGE =
  "Hi, I’m Skypadi — your AI travel agent.\n\nTell me where you want to travel, and I’ll help you find the cheapest flight that won’t give you stress.";

export function addFirstTimeOnboarding(intent: UiIntent | undefined, context: ChatContext): UiIntent | undefined {
  if (!intent || !isFirstUserReply(context)) return intent;
  if (isGenericGreetingReply(intent)) {
    return {
      ...intent,
      body: SKYPADI_ONBOARDING_MESSAGE,
    };
  }
  if (!supportsOnboardingPrefix(intent)) return intent;
  return {
    ...intent,
    body: `${SKYPADI_ONBOARDING_MESSAGE}\n\n${intent.body}`,
  };
}

function isFirstUserReply(context: ChatContext): boolean {
  const messages = context.recentMessages ?? [];
  const hasDraft = Boolean(context.currentDraft && Object.keys(context.currentDraft).length > 0);
  return !hasDraft && !messages.some((message) => message.direction === "outbound" || message.direction === "system");
}

function supportsOnboardingPrefix(intent: UiIntent): boolean {
  return (
    intent.type === "text" ||
    intent.type === "flight_list" ||
    intent.type === "reply_buttons" ||
    intent.type === "passenger_details_flow"
  );
}

function isGenericGreetingReply(intent: UiIntent): boolean {
  if (intent.type !== "text") return false;
  const normalized = intent.body.trim().toLowerCase();
  return (
    normalized.startsWith("hi") ||
    normalized.startsWith("hello") ||
    normalized.startsWith("hey") ||
    normalized.startsWith("sure.")
  ) && /where are you flying|where to|what date|how many adult/.test(normalized);
}
