import type { ChatContext } from "../../tools/chat-tool.types";
import type { UiIntent } from "./whatsapp.types";

const FIRST_TIME_ONBOARDING =
  "Hi, I’m Skypadi — your AI travel agent.\n\nTell me where you want to travel, and I’ll help you find the cheapest flight that won’t give you stress.";

export function addFirstTimeOnboarding(intent: UiIntent | undefined, context: ChatContext): UiIntent | undefined {
  if (!intent || !shouldAddFirstTimeOnboarding(intent, context)) return intent;
  return {
    ...intent,
    body: `${FIRST_TIME_ONBOARDING}\n\n${intent.body}`,
  };
}

function shouldAddFirstTimeOnboarding(intent: UiIntent, context: ChatContext): boolean {
  if (
    intent.type !== "text" &&
    intent.type !== "flight_list" &&
    intent.type !== "reply_buttons" &&
    intent.type !== "passenger_details_flow"
  ) {
    return false;
  }

  const messages = context.recentMessages ?? [];
  const hasDraft = Boolean(context.currentDraft && Object.keys(context.currentDraft).length > 0);
  return !hasDraft && !messages.some((message) => message.direction === "outbound" || message.direction === "system");
}
