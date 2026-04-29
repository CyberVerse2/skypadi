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
    }
  | {
      type: "passenger_details_flow";
      body: string;
      buttonText: string;
      flowId: string;
      flowToken: string;
      data: Record<string, unknown>;
    };

export type OriginListIntent = Extract<UiIntent, { type: "origin_list" }>;
export type FlightListIntent = Extract<UiIntent, { type: "flight_list" }>;
export type ReplyButtonsIntent = Extract<UiIntent, { type: "reply_buttons" }>;
export type TextIntent = Extract<UiIntent, { type: "text" }>;
export type DocumentIntent = Extract<UiIntent, { type: "document" }>;
export type PassengerDetailsFlowIntent = Extract<UiIntent, { type: "passenger_details_flow" }>;

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

export type WhatsAppInteractiveFlowMessage = {
  type: "interactive";
  interactive: {
    type: "flow";
    body: { text: string };
    action: {
      name: "flow";
      parameters: {
        flow_message_version: "3";
        flow_id: string;
        flow_token: string;
        flow_cta: string;
        flow_action: "navigate";
        flow_action_payload: {
          screen: string;
          data: Record<string, unknown>;
        };
      };
    };
  };
};

export type WhatsAppMessagePayload =
  | WhatsAppTextMessage
  | WhatsAppDocumentMessage
  | WhatsAppInteractiveListMessage
  | WhatsAppInteractiveButtonMessage
  | WhatsAppInteractiveFlowMessage;
