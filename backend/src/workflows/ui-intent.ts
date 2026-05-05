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
      type: "cta_button";
      body: string;
      button: { id: string; title: string };
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
export type CtaButtonIntent = Extract<UiIntent, { type: "cta_button" }>;
export type TextIntent = Extract<UiIntent, { type: "text" }>;
export type DocumentIntent = Extract<UiIntent, { type: "document" }>;
export type PassengerDetailsFlowIntent = Extract<UiIntent, { type: "passenger_details_flow" }>;
