import type {
  DocumentIntent,
  FlightListIntent,
  OriginListIntent,
  ReplyButtonsIntent,
  TextIntent,
  UiIntent,
  WhatsAppDocumentMessage,
  WhatsAppInteractiveButtonMessage,
  WhatsAppInteractiveListMessage,
  WhatsAppMessagePayload,
  WhatsAppTextMessage,
} from "./whatsapp.types.js";

const MAX_REPLY_BUTTONS = 3;
const MAX_LIST_ROWS = 10;
const MAX_INTERACTIVE_BODY_TEXT_LENGTH = 1024;
const MAX_LIST_CTA_BUTTON_TEXT_LENGTH = 20;
const MAX_REPLY_BUTTON_TITLE_LENGTH = 20;
const MAX_LIST_ROW_TITLE_LENGTH = 24;
const MAX_INTERACTIVE_ID_LENGTH = 200;
const MAX_LIST_ROW_DESCRIPTION_LENGTH = 72;
const MAX_DOCUMENT_FILENAME_LENGTH = 240;
const MAX_TEXT_BODY_LENGTH = 4096;
const MAX_DOCUMENT_CAPTION_LENGTH = 1024;
const LIST_CTA_BUTTON_TEXT = "Choose city";

export function mapUiIntentToWhatsAppMessage(intent: OriginListIntent): WhatsAppInteractiveListMessage;
export function mapUiIntentToWhatsAppMessage(intent: FlightListIntent): WhatsAppInteractiveListMessage;
export function mapUiIntentToWhatsAppMessage(intent: ReplyButtonsIntent): WhatsAppInteractiveButtonMessage;
export function mapUiIntentToWhatsAppMessage(intent: TextIntent): WhatsAppTextMessage;
export function mapUiIntentToWhatsAppMessage(intent: DocumentIntent): WhatsAppDocumentMessage;
export function mapUiIntentToWhatsAppMessage(intent: UiIntent): WhatsAppMessagePayload;
export function mapUiIntentToWhatsAppMessage(intent: UiIntent): WhatsAppMessagePayload {
  switch (intent.type) {
    case "origin_list":
      return mapOriginList(intent);
    case "flight_list":
      return mapFlightList(intent);
    case "reply_buttons":
      return mapReplyButtons(intent);
    case "text":
      assertPresent(intent.body, "text body");
      assertMaxLength(intent.body, MAX_TEXT_BODY_LENGTH, "text body");
      return {
        type: "text",
        text: { body: intent.body },
      };
    case "document":
      assertPresent(intent.body, "document body");
      assertMaxLength(intent.body, MAX_DOCUMENT_CAPTION_LENGTH, "document body");
      assertPresent(intent.documentUrl, "document link");
      assertPresent(intent.filename, "document filename");
      assertMaxLength(intent.filename, MAX_DOCUMENT_FILENAME_LENGTH, "document filename");
      return {
        type: "document",
        document: {
          link: intent.documentUrl,
          filename: intent.filename,
          caption: intent.body,
        },
      };
  }
}

function mapFlightList(intent: FlightListIntent): WhatsAppInteractiveListMessage {
  assertInteractiveBody(intent.body);
  assertPresent(intent.buttonText, "list CTA button text");
  assertMaxLength(intent.buttonText, MAX_LIST_CTA_BUTTON_TEXT_LENGTH, "list CTA button text");

  if (intent.rows.length < 1) {
    throw new Error("WhatsApp list messages require at least 1 row");
  }

  if (intent.rows.length > MAX_LIST_ROWS) {
    throw new Error(`WhatsApp list messages support at most ${MAX_LIST_ROWS} rows`);
  }

  for (const [index, row] of intent.rows.entries()) {
    const label = `list row ${index + 1}`;
    assertPresent(row.id, `${label} id`);
    assertMaxLength(row.id, MAX_INTERACTIVE_ID_LENGTH, `${label} id`);
    assertPresent(row.title, `${label} title`);
    assertMaxLength(row.title, MAX_LIST_ROW_TITLE_LENGTH, `${label} title`);
    if (row.description !== undefined) {
      assertMaxLength(row.description, MAX_LIST_ROW_DESCRIPTION_LENGTH, `${label} description`);
    }
  }

  return {
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: intent.body },
      action: {
        button: intent.buttonText,
        sections: [{ rows: intent.rows }],
      },
    },
  };
}

function mapOriginList(intent: OriginListIntent): WhatsAppInteractiveListMessage {
  assertInteractiveBody(intent.body);

  if (intent.rows.length < 1) {
    throw new Error("WhatsApp list messages require at least 1 row");
  }

  if (intent.rows.length > MAX_LIST_ROWS) {
    throw new Error(`WhatsApp list messages support at most ${MAX_LIST_ROWS} rows`);
  }

  assertPresent(LIST_CTA_BUTTON_TEXT, "list CTA button text");
  assertMaxLength(LIST_CTA_BUTTON_TEXT, MAX_LIST_CTA_BUTTON_TEXT_LENGTH, "list CTA button text");
  for (const [index, row] of intent.rows.entries()) {
    const label = `list row ${index + 1}`;
    assertPresent(row.id, `${label} id`);
    assertMaxLength(row.id, MAX_INTERACTIVE_ID_LENGTH, `${label} id`);
    assertPresent(row.title, `${label} title`);
    assertMaxLength(row.title, MAX_LIST_ROW_TITLE_LENGTH, `${label} title`);
    if (row.description !== undefined) {
      assertMaxLength(row.description, MAX_LIST_ROW_DESCRIPTION_LENGTH, `${label} description`);
    }
  }

  return {
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: intent.body },
      action: {
        button: LIST_CTA_BUTTON_TEXT,
        sections: [
          {
            rows: intent.rows,
          },
        ],
      },
    },
  };
}

function mapReplyButtons(intent: ReplyButtonsIntent): WhatsAppInteractiveButtonMessage {
  assertInteractiveBody(intent.body);

  if (intent.buttons.length < 1) {
    throw new Error("WhatsApp reply button messages require at least 1 button");
  }

  if (intent.buttons.length > MAX_REPLY_BUTTONS) {
    throw new Error(`WhatsApp reply button messages support at most ${MAX_REPLY_BUTTONS} buttons`);
  }

  for (const [index, button] of intent.buttons.entries()) {
    const label = `reply button ${index + 1}`;
    assertPresent(button.id, `${label} id`);
    assertMaxLength(button.id, MAX_INTERACTIVE_ID_LENGTH, `${label} id`);
    assertPresent(button.title, `${label} title`);
    assertMaxLength(button.title, MAX_REPLY_BUTTON_TITLE_LENGTH, `${label} title`);
  }

  return {
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: intent.body },
      action: {
        buttons: intent.buttons.map((button) => ({
          type: "reply",
          reply: button,
        })),
      },
    },
  };
}

function assertInteractiveBody(body: string): void {
  assertPresent(body, "interactive body");
  assertMaxLength(body, MAX_INTERACTIVE_BODY_TEXT_LENGTH, "interactive body");
}

function assertPresent(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new Error(`WhatsApp ${field} cannot be blank`);
  }
}

function assertMaxLength(value: string, maxLength: number, field: string): void {
  if (value.length > maxLength) {
    throw new Error(`WhatsApp ${field} must be at most ${maxLength} characters`);
  }
}
