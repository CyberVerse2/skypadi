export type UiIntent =
  | {
      type: "origin_list";
      body: string;
      rows: Array<{ id: string; title: string; description?: string }>;
    }
  | {
      type: "flight_list";
      body: string;
      buttonText: string;
      rows: Array<{ id: string; title: string; description?: string }>;
    }
  | {
      type: "reply_buttons";
      body: string;
      buttons: Array<{ id: string; title: string }>;
    }
  | {
      type: "text";
      body: string;
    }
  | {
      type: "document";
      body: string;
      documentUrl: string;
      filename: string;
    };

export type OriginListIntent = Extract<UiIntent, { type: "origin_list" }>;
export type FlightListIntent = Extract<UiIntent, { type: "flight_list" }>;
export type ReplyButtonsIntent = Extract<UiIntent, { type: "reply_buttons" }>;
export type TextIntent = Extract<UiIntent, { type: "text" }>;
export type DocumentIntent = Extract<UiIntent, { type: "document" }>;

export type WhatsAppTextMessage = {
  type: "text";
  text: { body: string };
};

export type WhatsAppDocumentMessage = {
  type: "document";
  document: {
    link: string;
    filename: string;
    caption?: string;
  };
};

export type WhatsAppInteractiveListMessage = {
  type: "interactive";
  interactive: {
    type: "list";
    body: { text: string };
    action: {
      button: string;
      sections: Array<{
        rows: Array<{ id: string; title: string; description?: string }>;
      }>;
    };
  };
};

export type WhatsAppInteractiveButtonMessage = {
  type: "interactive";
  interactive: {
    type: "button";
    body: { text: string };
    action: {
      buttons: Array<{
        type: "reply";
        reply: { id: string; title: string };
      }>;
    };
  };
};

export type WhatsAppMessagePayload =
  | WhatsAppTextMessage
  | WhatsAppDocumentMessage
  | WhatsAppInteractiveListMessage
  | WhatsAppInteractiveButtonMessage;
