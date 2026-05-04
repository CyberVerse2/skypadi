import type { BankTransferDetails, BookingContactContext, BookingFlightSummary } from "../../schemas/booking-contract";
import type { Passenger } from "../../schemas/flight-booking";

export type WakanowAccountCredentials = {
  email: string;
  password: string;
};

export type WakanowAccountAuthFetch = (url: string, init?: RequestInit) => Promise<Response>;

export type WakanowAccountAuthOptions = {
  credentials?: WakanowAccountCredentials | null;
  fetchImpl?: WakanowAccountAuthFetch;
  now?: () => number;
};

export type WakanowAccountTokenResponse = {
  access_token?: string;
  userName?: string;
  ".expires"?: string;
  expires_in?: number;
};

export type WakanowAccountTokenCache = {
  accessToken: string;
  expiresAt: number;
};

export type WakanowSupplier = "wakanow";

export type WakanowDirectBookingFetch = (url: string, init?: RequestInit) => Promise<Response>;

export type WakanowDirectBookingStage =
  | "select"
  | "validate"
  | "submit_booking"
  | "payment_options"
  | "generate_pnr"
  | "make_payment";

export type WakanowDirectBookingRequest = {
  bookingId?: string;
  searchKey: string;
  flightId: string;
  passenger: Passenger;
  contactEmail: string;
  supplierState?: WakanowSupplierBookingState;
  resolveOtp?: (input: {
    bookingId?: string;
    customerEmail: string;
    contactEmail: string;
  }) => Promise<{ code: string; consume: () => Promise<void> } | undefined>;
};

export type WakanowSupplierBookingState = {
  supplierBookingId?: string;
  selectData?: unknown;
  bankTransfers?: BankTransferDetails[];
  stage?: "selected" | "validated" | "submitted" | "payment_pending";
};

export type WakanowDirectBookingResponse = {
  provider: WakanowSupplier;
  bookedAt: string;
  bookingId: string;
  status: "pending_payment";
  paymentUrl: string;
  bankTransfers?: BankTransferDetails[];
  contactContext: BookingContactContext;
  flightSummary: BookingFlightSummary;
  rawStatus: string;
};

export type WakanowDirectBookingOptions = {
  fetchImpl?: WakanowDirectBookingFetch;
  accountCredentials?: WakanowAccountCredentials;
  now?: () => Date;
  onStateChange?: (state: WakanowSupplierBookingState) => Promise<void>;
};

export type WakanowSelectFlightResponse = {
  SearchKey?: string;
  BookingId?: string;
  SelectData?: unknown;
  IsPassportRequired?: boolean | string;
  SelectFlightResult?: {
    BookingId?: string;
    SelectData?: unknown;
    IsPassportRequired?: boolean | string;
  };
};

export type WakanowPaymentResponse = {
  PaymentResponseModel?: {
    BookingId?: string;
    TotalPrice?: { Amount?: number; CurrencyCode?: string };
    BillingAddress?: unknown;
    PaymentOptions?: WakanowPaymentOption[];
  };
};

export type WakanowPaymentOption = {
  Id?: number | string;
  Name?: string;
  IsCorporateCheckout?: boolean;
  PaymentMethods?: WakanowPaymentMethod[];
};

export type WakanowPaymentMethod = {
  Id?: number | string;
  Name?: string;
  PaymentDescription?: string;
};

export type WakanowApiSearchResponse = {
  HasResult: boolean;
  SearchFlightResults: WakanowApiFlightResult[];
};

export type WakanowApiFlightResult = {
  FlightCombination: {
    Flights: Array<{
      AirlineName: string;
      Airline: string;
      DepartureCode: string;
      DepartureName: string;
      DepartureTime: string;
      ArrivalCode: string;
      ArrivalName: string;
      ArrivalTime: string;
      Stops: number;
      TripDuration: string;
    }>;
    Price: {
      Amount: number;
      CurrencyCode: string;
    };
    Source: string;
  };
  FlightId: string;
};

export type WakanowHoldClient = {
  createHold(input: WakanowHoldRequest): Promise<SupplierHoldResult>;
  createHoldForBooking(input: { bookingId: string }): Promise<SupplierHoldResult>;
};

export type WakanowHoldRequest = {
  bookingId: string;
  selectedFlightOptionId: string;
  passengerSnapshot: Record<string, unknown>;
  contactEmail: string;
  supplierBookingState?: WakanowSupplierBookingState;
};

export type SupplierHoldResult =
  | {
      kind: "hold_created";
      supplier: WakanowSupplier;
      supplierBookingRef: string;
      expiresAt: Date;
      amountDue: number;
      currency: "NGN";
      paymentUrl?: string;
      bankTransfers?: BankTransferDetails[];
      rawStatus: string;
    }
  | {
      kind: "instant_purchase_required";
      supplier: WakanowSupplier;
      reason: string;
      amountDue: number;
      currency: "NGN";
      rawStatus: string;
    }
  | {
      kind: "hold_unavailable";
      supplier: WakanowSupplier;
      reason: string;
      amountDue?: number;
      currency?: "NGN";
      rawStatus: string;
    }
  | {
      kind: "unclear";
      supplier: WakanowSupplier;
      reason: string;
      rawStatus: string;
    };

export type SupplierBookingPolicy = "hold_first" | "payment_first" | "manual_review";
