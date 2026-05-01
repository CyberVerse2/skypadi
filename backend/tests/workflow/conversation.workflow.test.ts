import assert from "node:assert/strict";

import type { ReplyButtonsIntent, TextIntent } from "../../src/channels/whatsapp/whatsapp.types";
import { createInMemoryConversationRepository } from "../../src/domain/conversation/conversation.service";
import type { IntentExtractor } from "../../src/agent/intent-extractor";
import { handleConversationEvent } from "../../src/workflows/conversation.workflow";

const repository = createInMemoryConversationRepository();
const defaultIntentExtractor: IntentExtractor = {
  async extractTripIntent(input) {
    if (input.expectedField === "return_date") {
      return input.text.toLowerCase().includes("next week") ? { returnDate: "2026-05-06" } : {};
    }

    if (input.expectedField === "passenger_count") {
      return /^\d+$/.test(input.text.trim()) ? { adults: Number.parseInt(input.text.trim(), 10) } : {};
    }

    return input.text.toLowerCase().includes("abuja")
      ? {
          destination: "Abuja",
          departureDate: "2026-04-30",
          departureWindow: "morning",
        }
      : {};
  },
};
const dependencies = { conversationRepository: repository, intentExtractor: defaultIntentExtractor };
const contact = { phoneNumber: "2348012345678" };

const missingIntentExtractor = await handleConversationEvent(
  {
    type: "inbound_text",
    contact: { phoneNumber: "2348000000000" },
    text: "I need a flight to Abuja tomorrow morning",
    providerMessageId: "wamid.missing-ai.1",
    now: new Date("2026-04-29T08:00:00.000Z"),
  },
  {
    conversationRepository: createInMemoryConversationRepository(),
  }
);

assert.equal(missingIntentExtractor.kind, "temporary_failure");
assert.equal(missingIntentExtractor.reason, "intent extractor dependency is required");

const greetingRepository = createInMemoryConversationRepository();
const greetingResult = await handleConversationEvent(
  {
    type: "inbound_text",
    contact: { phoneNumber: "2348000000001" },
    text: "Hi",
    providerMessageId: "wamid.greeting.1",
    now: new Date("2026-04-29T08:00:00.000Z"),
  },
  {
    conversationRepository: greetingRepository,
    intentExtractor: {
      async extractTripIntent() {
        return {
          kind: "general_chat",
          reply: "Hi, I’m Skypadi. I can help you find and book flights on WhatsApp. Tell me where you want to travel when you’re ready.",
        };
      },
    },
  }
);

assert.equal(greetingResult.kind, "needs_user_input");
assert.equal(greetingResult.field, "general_chat");
assert.equal((greetingResult.ui as TextIntent).type, "text");
assert.match((greetingResult.ui as TextIntent).body, /find and book flights/i);
assert.equal((await greetingRepository.findByPhoneNumber("2348000000001"))?.draft.expectedField, undefined);

const fakeNaturalLanguageRepository = createInMemoryConversationRepository();
const fakeNaturalLanguageExtractor: IntentExtractor = {
  async extractTripIntent() {
    return {
      origin: "PHC",
      destination: "KAN",
      departureDate: "2026-05-06",
      adults: 3,
    };
  },
};

const fakeNaturalLanguageResult = await handleConversationEvent(
  {
    type: "inbound_text",
    contact: { phoneNumber: "2348011111111" },
    text: "Book me PH to Kano next week for 3 adults",
    providerMessageId: "wamid.fake.nl.1",
    now: new Date("2026-04-29T08:00:00.000Z"),
  },
  {
    conversationRepository: fakeNaturalLanguageRepository,
    intentExtractor: fakeNaturalLanguageExtractor,
  }
);

assert.equal(fakeNaturalLanguageResult.kind, "needs_user_input");
assert.equal(fakeNaturalLanguageResult.field, "departure_window");

const vagueBookingRepository = createInMemoryConversationRepository();
const vagueBookingContact = { phoneNumber: "2348011111112" };
const vagueBookingExtractor: IntentExtractor = {
  async extractTripIntent(input) {
    if (input.expectedField === "destination" && /abuja/i.test(input.text)) {
      return { destination: "Abuja" };
    }

    if (input.expectedField === "departure_date" && /tomorrow/i.test(input.text)) {
      return { departureDate: "2026-04-30" };
    }

    if (input.expectedField === "departure_window" && /morning/i.test(input.text)) {
      return { departureWindow: "morning" };
    }

    return {};
  },
};

const vagueBookingStarted = await handleConversationEvent(
  {
    type: "inbound_text",
    contact: vagueBookingContact,
    text: "I want to book a flight",
    providerMessageId: "wamid.vague.1",
    now: new Date("2026-04-29T08:00:00.000Z"),
  },
  {
    conversationRepository: vagueBookingRepository,
    intentExtractor: vagueBookingExtractor,
  }
);

assert.equal(vagueBookingStarted.kind, "needs_user_input");
assert.equal(vagueBookingStarted.field, "origin");

const vagueBookingOrigin = await handleConversationEvent(
  {
    type: "interactive_reply",
    contact: vagueBookingContact,
    replyId: "origin:LOS",
    providerMessageId: "wamid.vague.2",
    now: new Date("2026-04-29T08:01:00.000Z"),
  },
  {
    conversationRepository: vagueBookingRepository,
    intentExtractor: vagueBookingExtractor,
  }
);

assert.equal(vagueBookingOrigin.kind, "needs_user_input");
assert.equal(vagueBookingOrigin.field, "destination");

const vagueBookingDestination = await handleConversationEvent(
  {
    type: "inbound_text",
    contact: vagueBookingContact,
    text: "Abuja",
    providerMessageId: "wamid.vague.3",
    now: new Date("2026-04-29T08:02:00.000Z"),
  },
  {
    conversationRepository: vagueBookingRepository,
    intentExtractor: vagueBookingExtractor,
  }
);

assert.equal(vagueBookingDestination.kind, "needs_user_input");
assert.equal(vagueBookingDestination.field, "departure_date");

const vagueBookingDepartureDate = await handleConversationEvent(
  {
    type: "inbound_text",
    contact: vagueBookingContact,
    text: "Tomorrow",
    providerMessageId: "wamid.vague.4",
    now: new Date("2026-04-29T08:03:00.000Z"),
  },
  {
    conversationRepository: vagueBookingRepository,
    intentExtractor: vagueBookingExtractor,
  }
);

assert.equal(vagueBookingDepartureDate.kind, "needs_user_input");
assert.equal(vagueBookingDepartureDate.field, "departure_window");

const vagueBookingDepartureWindow = await handleConversationEvent(
  {
    type: "inbound_text",
    contact: vagueBookingContact,
    text: "Morning",
    providerMessageId: "wamid.vague.5",
    now: new Date("2026-04-29T08:04:00.000Z"),
  },
  {
    conversationRepository: vagueBookingRepository,
    intentExtractor: vagueBookingExtractor,
  }
);

assert.equal(vagueBookingDepartureWindow.kind, "needs_user_input");
assert.equal(vagueBookingDepartureWindow.field, "trip_type");

await handleConversationEvent(
  {
    type: "interactive_reply",
    contact: vagueBookingContact,
    replyId: "trip_type:one_way",
    providerMessageId: "wamid.vague.6",
    now: new Date("2026-04-29T08:05:00.000Z"),
  },
  {
    conversationRepository: vagueBookingRepository,
    intentExtractor: vagueBookingExtractor,
  }
);

const vagueBookingReady = await handleConversationEvent(
  {
    type: "interactive_reply",
    contact: vagueBookingContact,
    replyId: "passengers:1",
    providerMessageId: "wamid.vague.7",
    now: new Date("2026-04-29T08:06:00.000Z"),
  },
  {
    conversationRepository: vagueBookingRepository,
    intentExtractor: vagueBookingExtractor,
  }
);

assert.equal(vagueBookingReady.kind, "ok");
assert.deepEqual(vagueBookingReady.value.search, {
  origin: "LOS",
  destination: "Abuja",
  departureDate: "2026-04-30",
  departureWindow: "morning",
  tripType: "one_way",
  adults: 1,
});

const broadAdultsOverwriteRepository = createInMemoryConversationRepository();
const broadAdultsOverwriteContact = { phoneNumber: "2348012222222" };
const broadAdultsOverwriteExtractor: IntentExtractor = {
  async extractTripIntent(input) {
    if (input.currentDraft.adults) {
      return {
        destination: "Kano",
        departureDate: "2099-01-01",
        adults: 9,
      };
    }

    return {
      destination: "Abuja",
      departureDate: "2026-04-30",
      departureWindow: "morning",
    };
  },
};

await handleConversationEvent(
  {
    type: "inbound_text",
    contact: broadAdultsOverwriteContact,
    text: "I need a flight to Abuja tomorrow morning",
    providerMessageId: "wamid.fake.broad-adults.1",
    now: new Date("2026-04-29T08:00:00.000Z"),
  },
  {
    conversationRepository: broadAdultsOverwriteRepository,
    intentExtractor: broadAdultsOverwriteExtractor,
  }
);
await handleConversationEvent(
  {
    type: "interactive_reply",
    contact: broadAdultsOverwriteContact,
    replyId: "origin:LOS",
    providerMessageId: "wamid.fake.broad-adults.2",
    now: new Date("2026-04-29T08:01:00.000Z"),
  },
  {
    conversationRepository: broadAdultsOverwriteRepository,
    intentExtractor: broadAdultsOverwriteExtractor,
  }
);
await handleConversationEvent(
  {
    type: "interactive_reply",
    contact: broadAdultsOverwriteContact,
    replyId: "trip_type:one_way",
    providerMessageId: "wamid.fake.broad-adults.3",
    now: new Date("2026-04-29T08:02:00.000Z"),
  },
  {
    conversationRepository: broadAdultsOverwriteRepository,
    intentExtractor: broadAdultsOverwriteExtractor,
  }
);
const broadAdultsInitialReady = await handleConversationEvent(
  {
    type: "interactive_reply",
    contact: broadAdultsOverwriteContact,
    replyId: "passengers:2",
    providerMessageId: "wamid.fake.broad-adults.4",
    now: new Date("2026-04-29T08:03:00.000Z"),
  },
  {
    conversationRepository: broadAdultsOverwriteRepository,
    intentExtractor: broadAdultsOverwriteExtractor,
  }
);

assert.equal(broadAdultsInitialReady.kind, "ok");
assert.equal(broadAdultsInitialReady.value.search.adults, 2);

const broadAdultsFollowUp = await handleConversationEvent(
  {
    type: "inbound_text",
    contact: broadAdultsOverwriteContact,
    text: "actually keep going",
    providerMessageId: "wamid.fake.broad-adults.5",
    now: new Date("2026-04-29T08:04:00.000Z"),
  },
  {
    conversationRepository: broadAdultsOverwriteRepository,
    intentExtractor: broadAdultsOverwriteExtractor,
  }
);

assert.equal(broadAdultsFollowUp.kind, "ok");
assert.equal(broadAdultsFollowUp.value.search.adults, 2);
assert.equal((await broadAdultsOverwriteRepository.findByPhoneNumber(broadAdultsOverwriteContact.phoneNumber))?.draft.adults, 2);

const fakePassengerCountRepository = createInMemoryConversationRepository();
const fakePassengerCountContact = { phoneNumber: "2348022222222" };
const fakePassengerCountExtractor: IntentExtractor = {
  async extractTripIntent(input) {
    if (input.expectedField === "passenger_count") {
      return {
        origin: "ABV",
        destination: "Kano",
        departureDate: "2099-01-01",
        adults: 4,
      };
    }

    return {
      destination: "Abuja",
      departureDate: "2026-04-30",
      departureWindow: "morning",
    };
  },
};

await handleConversationEvent(
  {
    type: "inbound_text",
    contact: fakePassengerCountContact,
    text: "I need a flight to Abuja tomorrow morning",
    providerMessageId: "wamid.fake.passengers.1",
    now: new Date("2026-04-29T08:00:00.000Z"),
  },
  {
    conversationRepository: fakePassengerCountRepository,
    intentExtractor: fakePassengerCountExtractor,
  }
);
await handleConversationEvent(
  {
    type: "interactive_reply",
    contact: fakePassengerCountContact,
    replyId: "origin:LOS",
    providerMessageId: "wamid.fake.passengers.2",
    now: new Date("2026-04-29T08:01:00.000Z"),
  },
  {
    conversationRepository: fakePassengerCountRepository,
    intentExtractor: fakePassengerCountExtractor,
  }
);
await handleConversationEvent(
  {
    type: "interactive_reply",
    contact: fakePassengerCountContact,
    replyId: "trip_type:one_way",
    providerMessageId: "wamid.fake.passengers.3",
    now: new Date("2026-04-29T08:02:00.000Z"),
  },
  {
    conversationRepository: fakePassengerCountRepository,
    intentExtractor: fakePassengerCountExtractor,
  }
);
await handleConversationEvent(
  {
    type: "interactive_reply",
    contact: fakePassengerCountContact,
    replyId: "passengers:more",
    providerMessageId: "wamid.fake.passengers.4",
    now: new Date("2026-04-29T08:03:00.000Z"),
  },
  {
    conversationRepository: fakePassengerCountRepository,
    intentExtractor: fakePassengerCountExtractor,
  }
);

const fakePassengerCountResult = await handleConversationEvent(
  {
    type: "inbound_text",
    contact: fakePassengerCountContact,
    text: "we are four",
    providerMessageId: "wamid.fake.passengers.5",
    now: new Date("2026-04-29T08:04:00.000Z"),
  },
  {
    conversationRepository: fakePassengerCountRepository,
    intentExtractor: fakePassengerCountExtractor,
  }
);

assert.equal(fakePassengerCountResult.kind, "ok");
assert.deepEqual(fakePassengerCountResult.value, {
  status: "search_ready",
  search: {
    origin: "LOS",
    destination: "Abuja",
    departureDate: "2026-04-30",
    departureWindow: "morning",
    tripType: "one_way",
    adults: 4,
  },
});

const fakeReturnDateRepository = createInMemoryConversationRepository();
const fakeReturnDateContact = { phoneNumber: "2348044444444" };
const fakeReturnDateExtractor: IntentExtractor = {
  async extractTripIntent(input) {
    if (input.expectedField === "return_date") {
      return {
        origin: "ABV",
        destination: "Kano",
        departureDate: "2099-01-01",
        returnDate: "2026-05-06",
        adults: 9,
      };
    }

    return {
      destination: "Abuja",
      departureDate: "2026-04-30",
      departureWindow: "morning",
    };
  },
};

await handleConversationEvent(
  {
    type: "inbound_text",
    contact: fakeReturnDateContact,
    text: "I need a flight to Abuja tomorrow morning",
    providerMessageId: "wamid.fake.return.1",
    now: new Date("2026-04-29T08:00:00.000Z"),
  },
  {
    conversationRepository: fakeReturnDateRepository,
    intentExtractor: fakeReturnDateExtractor,
  }
);
await handleConversationEvent(
  {
    type: "interactive_reply",
    contact: fakeReturnDateContact,
    replyId: "origin:LOS",
    providerMessageId: "wamid.fake.return.2",
    now: new Date("2026-04-29T08:01:00.000Z"),
  },
  {
    conversationRepository: fakeReturnDateRepository,
    intentExtractor: fakeReturnDateExtractor,
  }
);
const fakeReturnTripSelected = await handleConversationEvent(
  {
    type: "interactive_reply",
    contact: fakeReturnDateContact,
    replyId: "trip_type:return",
    providerMessageId: "wamid.fake.return.3",
    now: new Date("2026-04-29T08:02:00.000Z"),
  },
  {
    conversationRepository: fakeReturnDateRepository,
    intentExtractor: fakeReturnDateExtractor,
  }
);

assert.equal(fakeReturnTripSelected.kind, "needs_user_input");
assert.equal(fakeReturnTripSelected.field, "return_date");

const fakeReturnDateResult = await handleConversationEvent(
  {
    type: "inbound_text",
    contact: fakeReturnDateContact,
    text: "next week",
    providerMessageId: "wamid.fake.return.4",
    now: new Date("2026-04-29T08:03:00.000Z"),
  },
  {
    conversationRepository: fakeReturnDateRepository,
    intentExtractor: fakeReturnDateExtractor,
  }
);

assert.equal(fakeReturnDateResult.kind, "needs_user_input");
assert.equal(fakeReturnDateResult.field, "passengers");

const fakeReturnPassengerSelected = await handleConversationEvent(
  {
    type: "interactive_reply",
    contact: fakeReturnDateContact,
    replyId: "passengers:1",
    providerMessageId: "wamid.fake.return.5",
    now: new Date("2026-04-29T08:04:00.000Z"),
  },
  {
    conversationRepository: fakeReturnDateRepository,
    intentExtractor: fakeReturnDateExtractor,
  }
);

assert.equal(fakeReturnPassengerSelected.kind, "ok");
assert.deepEqual(fakeReturnPassengerSelected.value, {
  status: "search_ready",
  search: {
    origin: "LOS",
    destination: "Abuja",
    departureDate: "2026-04-30",
    departureWindow: "morning",
    tripType: "return",
    returnDate: "2026-05-06",
    adults: 1,
  },
});

const interactiveExtractorRepository = createInMemoryConversationRepository();
const interactiveExtractorContact = { phoneNumber: "2348033333333" };
let interactiveExtractorCallCount = 0;
const interactiveCallCountingExtractor: IntentExtractor = {
  async extractTripIntent() {
    interactiveExtractorCallCount += 1;
    return {
      destination: "Abuja",
      departureDate: "2026-04-30",
      departureWindow: "morning",
    };
  },
};

await handleConversationEvent(
  {
    type: "inbound_text",
    contact: interactiveExtractorContact,
    text: "I need a flight to Abuja tomorrow morning",
    providerMessageId: "wamid.fake.interactive.1",
    now: new Date("2026-04-29T08:00:00.000Z"),
  },
  {
    conversationRepository: interactiveExtractorRepository,
    intentExtractor: interactiveCallCountingExtractor,
  }
);
interactiveExtractorCallCount = 0;

await handleConversationEvent(
  {
    type: "interactive_reply",
    contact: interactiveExtractorContact,
    replyId: "origin:LOS",
    providerMessageId: "wamid.fake.interactive.2",
    now: new Date("2026-04-29T08:01:00.000Z"),
  },
  {
    conversationRepository: interactiveExtractorRepository,
    intentExtractor: interactiveCallCountingExtractor,
  }
);

assert.equal(interactiveExtractorCallCount, 0);

const firstMessage = await handleConversationEvent(
  {
    type: "inbound_text",
    contact,
    text: "I need a flight to Abuja tomorrow morning",
    providerMessageId: "wamid.1",
    now: new Date("2026-04-29T08:00:00.000Z"),
  },
  dependencies
);

assert.equal(firstMessage.kind, "needs_user_input");
assert.equal(firstMessage.field, "origin");
assert.equal((firstMessage.ui as { type: string }).type, "origin_list");

const originSelected = await handleConversationEvent(
  {
    type: "interactive_reply",
    contact,
    replyId: "origin:LOS",
    providerMessageId: "wamid.2",
    now: new Date("2026-04-29T08:01:00.000Z"),
  },
  dependencies
);

assert.equal(originSelected.kind, "needs_user_input");
assert.equal(originSelected.field, "trip_type");
assert.deepEqual((originSelected.ui as ReplyButtonsIntent).buttons.map((button) => button.id), [
  "trip_type:one_way",
  "trip_type:return",
]);

const tripTypeSelected = await handleConversationEvent(
  {
    type: "interactive_reply",
    contact,
    replyId: "trip_type:one_way",
    providerMessageId: "wamid.3",
    now: new Date("2026-04-29T08:02:00.000Z"),
  },
  dependencies
);

assert.equal(tripTypeSelected.kind, "needs_user_input");
assert.equal(tripTypeSelected.field, "passengers");
assert.deepEqual((tripTypeSelected.ui as ReplyButtonsIntent).buttons.map((button) => button.id), [
  "passengers:1",
  "passengers:2",
  "passengers:more",
]);

const passengerSelected = await handleConversationEvent(
  {
    type: "interactive_reply",
    contact,
    replyId: "passengers:1",
    providerMessageId: "wamid.4",
    now: new Date("2026-04-29T08:03:00.000Z"),
  },
  dependencies
);

assert.equal(passengerSelected.kind, "ok");
assert.deepEqual(passengerSelected.value, {
  status: "search_ready",
  search: {
    origin: "LOS",
    destination: "Abuja",
    departureDate: "2026-04-30",
    departureWindow: "morning",
    tripType: "one_way",
    adults: 1,
  },
});

const firstTimePrompts = [
  firstMessage,
  originSelected,
  tripTypeSelected,
  passengerSelected,
].filter((result) => result.kind === "needs_user_input");

assert.equal(
  firstTimePrompts.some((result) => result.field === "optimization_preference"),
  false
);

const labelReplyRepository = createInMemoryConversationRepository();
const labelReplyDependencies = { conversationRepository: labelReplyRepository, intentExtractor: defaultIntentExtractor };

await handleConversationEvent(
  {
    type: "inbound_text",
    contact: { phoneNumber: "2348099999999" },
    text: "I need a flight to Abuja tomorrow morning",
    providerMessageId: "wamid.label.1",
    now: new Date("2026-04-29T08:00:00.000Z"),
  },
  labelReplyDependencies
);

const labelReply = await handleConversationEvent(
  {
    type: "interactive_reply",
    contact: { phoneNumber: "2348099999999" },
    replyId: "Lagos",
    providerMessageId: "wamid.label.2",
    now: new Date("2026-04-29T08:01:00.000Z"),
  },
  labelReplyDependencies
);

assert.equal(labelReply.kind, "needs_user_input");
assert.equal(labelReply.field, "origin");
assert.equal((labelReply.ui as { type: string }).type, "origin_list");

const labelReplyConversation = await labelReplyRepository.findByPhoneNumber("2348099999999");
assert.equal(labelReplyConversation?.draft.origin, undefined);

const staleReplyRepository = createInMemoryConversationRepository();
const staleReplyDependencies = { conversationRepository: staleReplyRepository, intentExtractor: defaultIntentExtractor };

await handleConversationEvent(
  {
    type: "inbound_text",
    contact: { phoneNumber: "2348088888888" },
    text: "I need a flight to Abuja tomorrow morning",
    providerMessageId: "wamid.stale.1",
    now: new Date("2026-04-29T08:00:00.000Z"),
  },
  staleReplyDependencies
);

const staleReply = await handleConversationEvent(
  {
    type: "interactive_reply",
    contact: { phoneNumber: "2348088888888" },
    replyId: "trip_type:one_way",
    providerMessageId: "wamid.stale.2",
    now: new Date("2026-04-29T08:01:00.000Z"),
  },
  staleReplyDependencies
);

assert.equal(staleReply.kind, "needs_user_input");
assert.equal(staleReply.field, "origin");
assert.equal((staleReply.ui as { type: string }).type, "origin_list");

const staleReplyConversation = await staleReplyRepository.findByPhoneNumber("2348088888888");
assert.equal(staleReplyConversation?.draft.tripType, undefined);

const abvRepository = createInMemoryConversationRepository();
const abvDependencies = { conversationRepository: abvRepository, intentExtractor: defaultIntentExtractor };
const abvContact = { phoneNumber: "2348077777777" };

await handleConversationEvent(
  {
    type: "inbound_text",
    contact: abvContact,
    text: "I need a flight to Abuja tomorrow morning",
    providerMessageId: "wamid.abv.1",
    now: new Date("2026-04-29T08:00:00.000Z"),
  },
  abvDependencies
);

const abvOriginSelected = await handleConversationEvent(
  {
    type: "interactive_reply",
    contact: abvContact,
    replyId: "origin:ABV",
    providerMessageId: "wamid.abv.2",
    now: new Date("2026-04-29T08:01:00.000Z"),
  },
  abvDependencies
);

assert.equal(abvOriginSelected.kind, "needs_user_input");
assert.equal(abvOriginSelected.field, "trip_type");

await handleConversationEvent(
  {
    type: "interactive_reply",
    contact: abvContact,
    replyId: "trip_type:one_way",
    providerMessageId: "wamid.abv.3",
    now: new Date("2026-04-29T08:02:00.000Z"),
  },
  abvDependencies
);

const abvPassengerSelected = await handleConversationEvent(
  {
    type: "interactive_reply",
    contact: abvContact,
    replyId: "passengers:1",
    providerMessageId: "wamid.abv.4",
    now: new Date("2026-04-29T08:03:00.000Z"),
  },
  abvDependencies
);

assert.equal(abvPassengerSelected.kind, "ok");
assert.equal(abvPassengerSelected.value.search.origin, "ABV");

const returnTripRepository = createInMemoryConversationRepository();
const returnTripDependencies = { conversationRepository: returnTripRepository, intentExtractor: defaultIntentExtractor };
const returnTripContact = { phoneNumber: "2348066666666" };

await handleConversationEvent(
  {
    type: "inbound_text",
    contact: returnTripContact,
    text: "I need a flight to Abuja tomorrow morning",
    providerMessageId: "wamid.return.1",
    now: new Date("2026-04-29T08:00:00.000Z"),
  },
  returnTripDependencies
);
await handleConversationEvent(
  {
    type: "interactive_reply",
    contact: returnTripContact,
    replyId: "origin:LOS",
    providerMessageId: "wamid.return.2",
    now: new Date("2026-04-29T08:01:00.000Z"),
  },
  returnTripDependencies
);

const returnTripSelected = await handleConversationEvent(
  {
    type: "interactive_reply",
    contact: returnTripContact,
    replyId: "trip_type:return",
    providerMessageId: "wamid.return.3",
    now: new Date("2026-04-29T08:02:00.000Z"),
  },
  returnTripDependencies
);

assert.equal(returnTripSelected.kind, "needs_user_input");
assert.equal(returnTripSelected.field, "return_date");
assert.equal((returnTripSelected.ui as TextIntent).type, "text");

const returnTripPassengerReply = await handleConversationEvent(
  {
    type: "interactive_reply",
    contact: returnTripContact,
    replyId: "passengers:1",
    providerMessageId: "wamid.return.4",
    now: new Date("2026-04-29T08:03:00.000Z"),
  },
  returnTripDependencies
);

assert.equal(returnTripPassengerReply.kind, "needs_user_input");
assert.equal(returnTripPassengerReply.field, "return_date");

const invalidReturnDate = await handleConversationEvent(
  {
    type: "inbound_text",
    contact: returnTripContact,
    text: "someday soon",
    providerMessageId: "wamid.return.5",
    now: new Date("2026-04-29T08:04:00.000Z"),
  },
  returnTripDependencies
);

assert.equal(invalidReturnDate.kind, "needs_user_input");
assert.equal(invalidReturnDate.field, "return_date");

const returnDateProvided = await handleConversationEvent(
  {
    type: "inbound_text",
    contact: returnTripContact,
    text: "next week",
    providerMessageId: "wamid.return.6",
    now: new Date("2026-04-29T08:05:00.000Z"),
  },
  returnTripDependencies
);

assert.equal(returnDateProvided.kind, "needs_user_input");
assert.equal(returnDateProvided.field, "passengers");
assert.deepEqual((returnDateProvided.ui as ReplyButtonsIntent).buttons.map((button) => button.id), [
  "passengers:1",
  "passengers:2",
  "passengers:more",
]);

const returnPassengerSelected = await handleConversationEvent(
  {
    type: "interactive_reply",
    contact: returnTripContact,
    replyId: "passengers:1",
    providerMessageId: "wamid.return.7",
    now: new Date("2026-04-29T08:06:00.000Z"),
  },
  returnTripDependencies
);

assert.equal(returnPassengerSelected.kind, "ok");
assert.deepEqual(returnPassengerSelected.value, {
  status: "search_ready",
  search: {
    origin: "LOS",
    destination: "Abuja",
    departureDate: "2026-04-30",
    departureWindow: "morning",
    tripType: "return",
    returnDate: "2026-05-06",
    adults: 1,
  },
});

const morePassengersRepository = createInMemoryConversationRepository();
const morePassengersDependencies = { conversationRepository: morePassengersRepository, intentExtractor: defaultIntentExtractor };
const morePassengersContact = { phoneNumber: "2348055555555" };

await handleConversationEvent(
  {
    type: "inbound_text",
    contact: morePassengersContact,
    text: "I need a flight to Abuja tomorrow morning",
    providerMessageId: "wamid.more.1",
    now: new Date("2026-04-29T08:00:00.000Z"),
  },
  morePassengersDependencies
);
await handleConversationEvent(
  {
    type: "interactive_reply",
    contact: morePassengersContact,
    replyId: "origin:LOS",
    providerMessageId: "wamid.more.2",
    now: new Date("2026-04-29T08:01:00.000Z"),
  },
  morePassengersDependencies
);
await handleConversationEvent(
  {
    type: "interactive_reply",
    contact: morePassengersContact,
    replyId: "trip_type:one_way",
    providerMessageId: "wamid.more.3",
    now: new Date("2026-04-29T08:02:00.000Z"),
  },
  morePassengersDependencies
);

const morePassengersSelected = await handleConversationEvent(
  {
    type: "interactive_reply",
    contact: morePassengersContact,
    replyId: "passengers:more",
    providerMessageId: "wamid.more.4",
    now: new Date("2026-04-29T08:03:00.000Z"),
  },
  morePassengersDependencies
);

assert.equal(morePassengersSelected.kind, "needs_user_input");
assert.equal(morePassengersSelected.field, "passenger_count");
assert.equal((morePassengersSelected.ui as TextIntent).type, "text");

const invalidPassengerCount = await handleConversationEvent(
  {
    type: "inbound_text",
    contact: morePassengersContact,
    text: "a few",
    providerMessageId: "wamid.more.5",
    now: new Date("2026-04-29T08:04:00.000Z"),
  },
  morePassengersDependencies
);

assert.equal(invalidPassengerCount.kind, "needs_user_input");
assert.equal(invalidPassengerCount.field, "passenger_count");

const passengerCountProvided = await handleConversationEvent(
  {
    type: "inbound_text",
    contact: morePassengersContact,
    text: "3",
    providerMessageId: "wamid.more.6",
    now: new Date("2026-04-29T08:05:00.000Z"),
  },
  morePassengersDependencies
);

assert.equal(passengerCountProvided.kind, "ok");
assert.deepEqual(passengerCountProvided.value, {
  status: "search_ready",
  search: {
    origin: "LOS",
    destination: "Abuja",
    departureDate: "2026-04-30",
    departureWindow: "morning",
    tripType: "one_way",
    adults: 3,
  },
});

console.log("conversation workflow tests passed");
