import type { UiIntent } from "./ui-intent";
import type { IntentExtractor, TripIntentExtraction } from "../agent/intent-extractor";
import { findOrCreateConversation } from "../domain/conversation/conversation.service";
import type {
  ConversationDraft,
  ConversationExpectedField,
  ConversationRepository,
} from "../domain/conversation/conversation.types";
import { tripFieldPromptIntent } from "./trip-field-prompts";
import { parseTripReplyId } from "./trip-reply-ids";
import { makeNeedsUserInput, makeOk, type WorkflowResult } from "./workflow-result";

type WorkflowContact = {
  phoneNumber: string;
};

export type ConversationWorkflowEvent =
  | {
      type: "inbound_text";
      contact: WorkflowContact;
      text: string;
      providerMessageId?: string;
      now: Date;
    }
  | {
      type: "interactive_reply";
      contact: WorkflowContact;
      replyId: string;
      providerMessageId?: string;
      now: Date;
    };

export type ConversationWorkflowDependencies = {
  conversationRepository: ConversationRepository;
  intentExtractor?: IntentExtractor;
};

export type SearchReadyPayload = {
  status: "search_ready";
  search: {
    origin: string;
    destination: string;
    departureDate: string;
    departureWindow: string;
    tripType: "one_way" | "return";
    returnDate?: string;
    adults: number;
  };
};

export async function handleConversationEvent(
  event: ConversationWorkflowEvent,
  dependencies?: ConversationWorkflowDependencies
): Promise<WorkflowResult<SearchReadyPayload>> {
  if (!dependencies?.conversationRepository) {
    return { kind: "temporary_failure", reason: "conversation repository dependency is required" };
  }

  if (!dependencies.intentExtractor) {
    return { kind: "temporary_failure", reason: "intent extractor dependency is required" };
  }

  const intentExtractor = dependencies.intentExtractor;
  const conversation = await findOrCreateConversation(
    dependencies.conversationRepository,
    event.contact.phoneNumber,
    event.now
  );
  const draft = { ...conversation.draft };

  if (event.type === "inbound_text") {
    const extraction = await intentExtractor.extractTripIntent({
      text: event.text,
      now: event.now,
      expectedField: draft.expectedField,
      currentDraft: { ...draft },
    });
    if (extraction.kind === "general_chat") {
      const result = makeNeedsUserInput("general_chat", generalChatTextIntent(extraction.reply));
      await dependencies.conversationRepository.save({ ...conversation, draft, updatedAt: event.now });
      return result;
    }
    mergeTripIntentExtraction(draft, extraction);

    const result = nextPromptOrReady(draft);
    await dependencies.conversationRepository.save({ ...conversation, draft, updatedAt: event.now });
    return result;
  }

  if (!replyMatchesExpectedField(event.replyId, draft.expectedField)) {
    const result = promptForExpectedField(draft);
    await dependencies.conversationRepository.save({ ...conversation, draft, updatedAt: event.now });
    return result;
  }

  const replyApplied = applyReplyId(draft, event.replyId);
  if (!replyApplied) {
    const result = promptForExpectedField(draft);
    await dependencies.conversationRepository.save({ ...conversation, draft, updatedAt: event.now });
    return result;
  }

  const result = nextPromptOrReady(draft);
  await dependencies.conversationRepository.save({ ...conversation, draft, updatedAt: event.now });
  return result;
}

function mergeTripIntentExtraction(draft: ConversationDraft, extraction: TripIntentExtraction): void {
  if (draft.expectedField === "passenger_count") {
    assignPositiveInteger(draft, extraction.adults);
    return;
  }

  if (draft.expectedField === "return_date") {
    assignMissingNonEmptyString(draft, "returnDate", extraction.returnDate);
    return;
  }

  if (draft.expectedField === "destination") {
    assignMissingNonEmptyString(draft, "destination", extraction.destination);
    return;
  }

  if (draft.expectedField === "departure_date") {
    assignMissingNonEmptyString(draft, "departureDate", extraction.departureDate);
    return;
  }

  if (draft.expectedField === "departure_window") {
    assignMissingNonEmptyString(draft, "departureWindow", extraction.departureWindow);
    return;
  }

  assignMissingNonEmptyString(draft, "origin", extraction.origin);
  assignMissingNonEmptyString(draft, "destination", extraction.destination);
  assignMissingNonEmptyString(draft, "departureDate", extraction.departureDate);
  assignMissingNonEmptyString(draft, "departureWindow", extraction.departureWindow);
  assignMissingNonEmptyString(draft, "returnDate", extraction.returnDate);
  assignMissingPositiveInteger(draft, extraction.adults);
}

function assignPositiveInteger(draft: ConversationDraft, adults: number | undefined): void {
  if (typeof adults === "number" && Number.isInteger(adults) && adults > 0) {
    draft.adults = adults;
  }
}

function assignMissingPositiveInteger(draft: ConversationDraft, adults: number | undefined): void {
  if (!draft.adults) {
    assignPositiveInteger(draft, adults);
  }
}

function assignMissingNonEmptyString(
  draft: ConversationDraft,
  field: "origin" | "destination" | "departureDate" | "departureWindow" | "returnDate",
  value: string | undefined
): void {
  const trimmedValue = value?.trim();
  if (!draft[field] && trimmedValue) {
    draft[field] = trimmedValue;
  }
}

function applyReplyId(draft: ConversationDraft, replyId: string): boolean {
  const reply = parseTripReplyId(replyId);
  if (!reply) return false;

  if (reply.kind === "origin") {
    draft.origin = reply.value;
    return true;
  }

  if (reply.kind === "trip_type") {
    draft.tripType = reply.value;
    return true;
  }

  if (reply.kind === "passengers" && reply.value === "more") {
    draft.expectedField = "passenger_count";
    return true;
  }

  if (reply.kind === "passengers" && typeof reply.value === "number") {
    draft.adults = reply.value;
    return true;
  }

  return false;
}

function nextPromptOrReady(draft: ConversationDraft): WorkflowResult<SearchReadyPayload> {
  if (!draft.origin) {
    return promptForField(draft, "origin");
  }

  if (!draft.destination) {
    return promptForField(draft, "destination");
  }

  if (!draft.departureDate) {
    return promptForField(draft, "departure_date");
  }

  if (!draft.departureWindow) {
    return promptForField(draft, "departure_window");
  }

  if (!draft.tripType) {
    return promptForField(draft, "trip_type");
  }

  if (draft.tripType === "return" && !draft.returnDate) {
    return promptForField(draft, "return_date");
  }

  if (draft.expectedField === "passenger_count" && !draft.adults) {
    return promptForField(draft, "passenger_count");
  }

  if (!draft.adults) {
    return promptForField(draft, "passengers");
  }

  if (
    draft.destination &&
    draft.departureDate &&
    draft.departureWindow &&
    (draft.tripType === "one_way" || (draft.tripType === "return" && draft.returnDate)) &&
    draft.adults
  ) {
    draft.expectedField = undefined;
    const search: SearchReadyPayload["search"] = {
      origin: draft.origin,
      destination: draft.destination,
      departureDate: draft.departureDate,
      departureWindow: draft.departureWindow,
      tripType: draft.tripType,
      adults: draft.adults,
    };

    if (draft.returnDate) {
      search.returnDate = draft.returnDate;
    }

    return makeOk({
      status: "search_ready",
      search,
    });
  }

  return { kind: "permanent_failure", reason: "Conversation is missing required search fields" };
}

function replyMatchesExpectedField(replyId: string, expectedField: ConversationExpectedField | undefined): boolean {
  if (!expectedField) {
    return false;
  }

  const reply = parseTripReplyId(replyId);
  if (!reply) return false;

  if (expectedField === "origin") return reply.kind === "origin";
  if (expectedField === "trip_type") return reply.kind === "trip_type";
  if (expectedField === "passengers") return reply.kind === "passengers";

  return false;
}

function promptForExpectedField(draft: ConversationDraft): WorkflowResult<SearchReadyPayload> {
  if (!draft.expectedField) {
    return nextPromptOrReady(draft);
  }

  return promptForField(draft, draft.expectedField);
}

function promptForField(
  draft: ConversationDraft,
  field: ConversationExpectedField
): WorkflowResult<SearchReadyPayload> {
  draft.expectedField = field;
  return makeNeedsUserInput(field, tripFieldPromptIntent(field));
}

function generalChatTextIntent(reply: string | undefined): UiIntent {
  return {
    type: "text",
    body: reply?.trim() || "Hi, I’m Skypadi. I can help you find and book flights on WhatsApp. Tell me where you want to travel when you’re ready.",
  };
}
