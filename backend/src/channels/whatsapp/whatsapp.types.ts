export type {
  CtaButtonIntent,
  DocumentIntent,
  FlightListIntent,
  OriginListIntent,
  PassengerDetailsFlowIntent,
  ReplyButtonsIntent,
  TextIntent,
  UiIntent,
} from "../../workflows/ui-intent";

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
