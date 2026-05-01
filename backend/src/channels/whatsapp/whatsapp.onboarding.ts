import type { ChatContext } from "../../tools/chat-tool.types";
import type { UiIntent } from "./whatsapp.types";

export const SKYPADI_ONBOARDING_MESSAGE =
  "Hi, I’m Skypadi — your AI travel agent.\n\nTell me where you want to travel, and I’ll help you find the cheapest flight that won’t give you stress.";

export function addFirstTimeOnboarding(intent: UiIntent | undefined, context: ChatContext): UiIntent | undefined {
  if (!intent || !isFirstUserReply(context)) return intent;
  if (!supportsOnboardingPrefix(intent)) return intent;
  return {
    ...intent,
    body: `${SKYPADI_ONBOARDING_MESSAGE}\n\n${intent.body}`,
  };
}

export function isFirstUserReply(context: ChatContext): boolean {
  const messages = context.recentMessages ?? [];
  const hasDraft = Boolean(context.currentDraft && Object.keys(context.currentDraft).length > 0);
  return !hasDraft && !messages.some((message) => message.direction === "outbound" || message.direction === "system");
}

function supportsOnboardingPrefix(intent: UiIntent): boolean {
  return (
    intent.type === "text" ||
    intent.type === "origin_list" ||
    intent.type === "flight_list" ||
    intent.type === "reply_buttons" ||
    intent.type === "cta_button" ||
    intent.type === "passenger_details_flow"
  );
}
