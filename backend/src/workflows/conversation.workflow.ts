import type { UiIntent } from "../channels/whatsapp/whatsapp.types.js";
import {
  createRuleBasedIntentExtractor,
  type IntentExtractor,
  type TripIntentExtraction,
} from "../agent/intent-extractor.js";
import {
  type ConversationExpectedField,
  type ConversationDraft,
  type ConversationRepository,
  findOrCreateConversation,
} from "../domain/conversation/conversation.service.js";
import { makeNeedsUserInput, makeOk, type WorkflowResult } from "./workflow-result.js";

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

  const intentExtractor = dependencies.intentExtractor ?? createRuleBasedIntentExtractor();
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
  if (replyId === "origin:LOS") {
    draft.origin = "LOS";
    return true;
  }

  if (replyId === "origin:ABV") {
    draft.origin = "ABV";
    return true;
  }

  if (replyId === "trip_type:one_way") {
    draft.tripType = "one_way";
    return true;
  }

  if (replyId === "trip_type:return") {
    draft.tripType = "return";
    return true;
  }

  if (replyId === "passengers:1") {
    draft.adults = 1;
    return true;
  }

  if (replyId === "passengers:2") {
    draft.adults = 2;
    return true;
  }

  if (replyId === "passengers:more") {
    draft.expectedField = "passenger_count";
    return true;
  }

  return false;
}

function nextPromptOrReady(draft: ConversationDraft): WorkflowResult<SearchReadyPayload> {
  if (!draft.origin) {
    return promptForField(draft, "origin");
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

  if (expectedField === "origin") {
    return replyId === "origin:LOS" || replyId === "origin:ABV";
  }

  if (expectedField === "trip_type") {
    return replyId === "trip_type:one_way" || replyId === "trip_type:return";
  }

  if (expectedField === "passengers") {
    return replyId === "passengers:1" || replyId === "passengers:2" || replyId === "passengers:more";
  }

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

  if (field === "origin") {
    return makeNeedsUserInput("origin", originListIntent());
  }

  if (field === "trip_type") {
    return makeNeedsUserInput("trip_type", tripTypeButtonsIntent());
  }

  if (field === "passengers") {
    return makeNeedsUserInput("passengers", passengerButtonsIntent());
  }

  if (field === "return_date") {
    return makeNeedsUserInput("return_date", returnDateTextIntent());
  }

  return makeNeedsUserInput("passenger_count", passengerCountTextIntent());
}

function originListIntent(): UiIntent {
  return {
    type: "origin_list",
    body: "Where are you flying from?",
    rows: [
      { id: "origin:LOS", title: "Lagos", description: "Murtala Muhammed Airport" },
      { id: "origin:ABV", title: "Abuja", description: "Nnamdi Azikiwe Airport" },
    ],
  };
}

function tripTypeButtonsIntent(): UiIntent {
  return {
    type: "reply_buttons",
    body: "Is this one-way or return?",
    buttons: [
      { id: "trip_type:one_way", title: "One-way" },
      { id: "trip_type:return", title: "Return" },
    ],
  };
}

function passengerButtonsIntent(): UiIntent {
  return {
    type: "reply_buttons",
    body: "How many adults are travelling?",
    buttons: [
      { id: "passengers:1", title: "1 adult" },
      { id: "passengers:2", title: "2 adults" },
      { id: "passengers:more", title: "More" },
    ],
  };
}

function returnDateTextIntent(): UiIntent {
  return {
    type: "text",
    body: "Return date collection is next. Please send your return date.",
  };
}

function passengerCountTextIntent(): UiIntent {
  return {
    type: "text",
    body: "Please type the number of adults travelling.",
  };
}
