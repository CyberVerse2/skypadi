import { createHash } from "node:crypto";

import type { BankTransferDetails } from "../../schemas/booking-contract";
import type { Passenger } from "../../schemas/flight-booking";
import { createWakanowAccountFetch } from "./account-auth";
import { selectWakanowFlightWithBrowser } from "./browser-session";
import { wakanowCommonHeaders, wakanowConfig } from "./wakanow.config";
import type {
  WakanowAccountCredentials,
  WakanowDirectBookingFetch,
  WakanowDirectBookingOptions,
  WakanowDirectBookingRequest,
  WakanowDirectBookingResponse,
  WakanowDirectBookingStage,
  WakanowPaymentMethod,
  WakanowPaymentOption,
  WakanowPaymentResponse,
  WakanowSelectFlightResponse,
  WakanowSupplierBookingState,
} from "./wakanow.types";

const COMMON_HEADERS = {
  ...wakanowCommonHeaders({ contentType: "json", currency: wakanowConfig.currency }),
  "Accept-Language": "en-NG",
};

export type {
  WakanowDirectBookingFetch,
  WakanowDirectBookingOptions,
  WakanowDirectBookingRequest,
  WakanowDirectBookingResponse,
  WakanowDirectBookingStage,
  WakanowSupplierBookingState,
} from "./wakanow.types";

export class WakanowDirectBookingError extends Error {
  stage: WakanowDirectBookingStage;
  details?: Record<string, unknown>;
  safeToFallback: boolean;

  constructor(message: string, input: {
    stage: WakanowDirectBookingStage;
    details?: Record<string, unknown>;
    safeToFallback?: boolean;
  }) {
    super(message);
    this.name = "WakanowDirectBookingError";
    this.stage = input.stage;
    this.details = input.details;
    this.safeToFallback = input.safeToFallback ?? false;
  }
}

export async function bookFlightWithWakanowApi(
  request: WakanowDirectBookingRequest,
  options: WakanowDirectBookingOptions = {},
): Promise<WakanowDirectBookingResponse> {
  const fetchImpl = options.fetchImpl ?? createWakanowAccountFetch(proxyFetch, {
    credentials: options.accountCredentials,
  });
  const now = options.now ?? (() => new Date());
  const currency = wakanowConfig.currency;

  const existingSupplierBookingId = request.supplierState?.supplierBookingId;
  const existingSelectData = request.supplierState?.selectData;
  const selectedFlightResult = existingSupplierBookingId && existingSelectData
    ? { BookingId: existingSupplierBookingId, SelectData: existingSelectData }
    : await selectFlight({ fetchImpl, request, currency, preferBrowser: !options.fetchImpl });

  const supplierBookingId = selectedFlightResult.BookingId;
  const selectData = selectedFlightResult.SelectData;
  if (!supplierBookingId || !selectData) {
    throw new WakanowDirectBookingError("Wakanow select response was missing booking data", {
      stage: "select",
      details: { response: selectedFlightResult },
      safeToFallback: true,
    });
  }
  if (!existingSupplierBookingId || !existingSelectData) {
    await options.onStateChange?.({
      supplierBookingId,
      selectData,
      stage: "selected",
    });
  }

  const validationRequest = buildValidationRequest({
    request,
    supplierBookingId,
    selectData,
    currency,
  });

  const validation = await validatePassengerDetails(fetchImpl, validationRequest, request);
  if (validation.verificationCode) {
    validationRequest.VerificationCode = validation.verificationCode;
    await validatePassengerDetails(fetchImpl, validationRequest, request, true);
    await validation.consume?.();
  }
  await options.onStateChange?.({
    supplierBookingId,
    selectData,
    stage: "validated",
  });

  await getJson({
    fetchImpl,
    stage: "submit_booking",
    url: `${wakanowConfig.booking.apiBaseUrl}/Booking/Booking/${supplierBookingId}`,
    headers: bookingAuthHeaders(supplierBookingId, now()),
  });
  await options.onStateChange?.({
    supplierBookingId,
    selectData,
    stage: "submitted",
  });

  const paymentMethods = await getJson<WakanowPaymentResponse>({
    fetchImpl,
    stage: "payment_options",
    url: `${wakanowConfig.booking.apiBaseUrl}/Payment/Get/${supplierBookingId}/Flight`,
  });
  const paymentSelection = selectBankTransferPayment(paymentMethods);

  await getJson({
    fetchImpl,
    stage: "generate_pnr",
    url: `${wakanowConfig.booking.apiBaseUrl}/Booking/GeneratePNR/${supplierBookingId}`,
  });

  const callbackUrl = `${wakanowConfig.webOrigin}/en-ng/booking/${supplierBookingId}/confirmation?products=Flight`;
  const payment = await postJson<WakanowPaymentResponse>({
    fetchImpl,
    stage: "make_payment",
    url: `${wakanowConfig.booking.apiBaseUrl}/Payment/MakePayment`,
    body: {
      BookingId: supplierBookingId,
      CallbackUrl: callbackUrl,
      PaymentOptionId: paymentSelection.option.Id,
      PaymentMethodId: paymentSelection.method.Id,
      BillingAddress: paymentSelection.billingAddress ?? defaultBillingAddress(request.passenger),
      IsCorporateCheckout: paymentSelection.option.IsCorporateCheckout ?? false,
    },
  });

  const paymentModel = payment.PaymentResponseModel ?? paymentMethods.PaymentResponseModel;
  const amountDue = paymentModel?.TotalPrice?.Amount ?? 0;
  const bankTransfers = parseBankTransfers(paymentModel);
  if (!amountDue || bankTransfers.length === 0) {
    throw new WakanowDirectBookingError("Wakanow payment response was missing bank transfer details", {
      stage: "make_payment",
      details: { payment },
    });
  }
  await options.onStateChange?.({
    supplierBookingId,
    selectData,
    bankTransfers,
    stage: "payment_pending",
  });

  return {
    provider: "wakanow",
    bookedAt: now().toISOString(),
    bookingId: supplierBookingId,
    status: "pending_payment",
    paymentUrl: `${wakanowConfig.webOrigin}/en-ng/booking/${supplierBookingId}/payment?products=Flight&reqKey=${request.searchKey}`,
    bankTransfers,
    contactContext: {
      customerEmail: request.passenger.email,
      bookingContactEmail: request.contactEmail,
      verificationMode: "internal_contact",
      verificationStatus: validation.verificationCode ? "automated" : "not_needed",
    },
    flightSummary: {
      airline: "",
      departure: "",
      arrival: "",
      departureTime: "",
      arrivalTime: "",
      price: amountDue,
      currency,
    },
    rawStatus: "pending_payment",
  };
}

async function selectFlight(input: {
  fetchImpl: WakanowDirectBookingFetch;
  request: WakanowDirectBookingRequest;
  currency: string;
  preferBrowser: boolean;
}): Promise<{ BookingId?: string; SelectData?: unknown }> {
  const body = {
    SearchKey: input.request.searchKey,
    FlightId: input.request.flightId,
    TargetCurrency: input.currency,
  };

  if (input.preferBrowser) {
    try {
      const selectedFlight = await selectFlightWithBrowser(body);
      return selectedFlight.SelectFlightResult ?? selectedFlight;
    } catch (error) {
      if (error instanceof WakanowDirectBookingError) throw error;
      // Direct fetch remains as a final fallback for environments where browser startup fails.
    }
  }

  const selectedFlight = await postJson<WakanowSelectFlightResponse>({
    fetchImpl: input.fetchImpl,
    stage: "select",
    url: `${wakanowConfig.search.apiBaseUrl}/Select/`,
    body,
    safeToFallback: true,
  });

  return selectedFlight.SelectFlightResult ?? selectedFlight;
}

async function selectFlightWithBrowser(body: Record<string, unknown>): Promise<WakanowSelectFlightResponse> {
  const response = await selectWakanowFlightWithBrowser({
    proxyUrl: undefined,
    selectBody: body,
  });

  return parseJsonResponse<WakanowSelectFlightResponse>({
    stage: "select",
    status: response.status,
    contentType: "application/json",
    text: response.text,
    safeToFallback: true,
    details: { transport: "browser" },
  });
}

async function validatePassengerDetails(
  fetchImpl: WakanowDirectBookingFetch,
  validationRequest: Record<string, unknown>,
  request: WakanowDirectBookingRequest,
  isRetry = false,
): Promise<{ verificationCode?: string; consume?: () => Promise<void> }> {
  try {
    await postJson({
      fetchImpl,
      stage: "validate",
      url: `${wakanowConfig.booking.apiBaseUrl}/Booking/Validate`,
      body: validationRequest,
    });
    return {};
  } catch (error) {
    if (!(error instanceof WakanowDirectBookingError) || isRetry || !isVerificationRequired(error)) {
      throw error;
    }

    const otp = await request.resolveOtp?.({
      bookingId: request.bookingId,
      customerEmail: request.passenger.email,
      contactEmail: request.contactEmail,
    });
    if (!otp) {
      throw new WakanowDirectBookingError("Wakanow requires email verification but no OTP was available", {
        stage: "validate",
        details: error.details,
      });
    }

    return { verificationCode: otp.code, consume: otp.consume };
  }
}

function buildValidationRequest(input: {
  request: WakanowDirectBookingRequest;
  supplierBookingId: string;
  selectData: unknown;
  currency: string;
}): Record<string, unknown> {
  return {
    PassengerDetails: [passengerToWakanowPassenger(input.request.passenger, input.request.contactEmail)],
    BookingItemModels: [
      {
        ProductType: "Flight",
        BookingData: input.selectData,
        TargetCurrency: input.currency,
      },
    ],
    GeographyId: "ng",
    Url: `${wakanowConfig.webOrigin}/en-ng/booking/${input.supplierBookingId}/customer-info?products=Flight`,
    LoginUrl: `${wakanowConfig.webOrigin}/en-ng/account/login`,
    PromoCode: undefined,
    CorporateCode: undefined,
    ReferralAgentId: undefined,
    BookingId: input.supplierBookingId,
    BookingChannel: "web",
  };
}

function passengerToWakanowPassenger(passenger: Passenger, contactEmail: string): Record<string, unknown> {
  const birthDate = parseDateParts(passenger.dateOfBirth);
  const phone = normalizePhone(passenger.phone);
  return {
    PassengerType: "Adult",
    Email: contactEmail,
    PhoneNumber: phone,
    Title: passenger.title,
    FirstName: passenger.firstName,
    LastName: passenger.lastName,
    MiddleName: passenger.middleName,
    Gender: normalizeGender(passenger.gender),
    DateOfBirth: `${birthDate.day} ${birthDate.monthName}, ${birthDate.year}`,
    Age: Math.max(0, new Date().getFullYear() - Number(birthDate.year)),
    CountryCode: "NG",
    Country: passenger.nationality || "Nigeria",
    Address: "",
    City: "",
    PostalCode: "",
    SelectedBaggages: [],
    SelectedSeats: [],
  };
}

function parseDateParts(isoDate: string): { year: string; monthName: string; day: string } {
  const [year, month, day] = isoDate.split("-");
  const date = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new WakanowDirectBookingError("Passenger date of birth is invalid", {
      stage: "validate",
      details: { dateOfBirth: isoDate },
    });
  }
  return {
    year,
    monthName: date.toLocaleString("en-US", { month: "long", timeZone: "UTC" }),
    day: String(Number(day)),
  };
}

function normalizeGender(gender: Passenger["gender"]): string {
  const value = gender.trim().toLowerCase();
  return value === "male" ? "Male" : "Female";
}

function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.startsWith("+")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.startsWith("234")) return `+${digits}`;
  if (digits.startsWith("0")) return `+234${digits.slice(1)}`;
  return `+234${digits}`;
}

function selectBankTransferPayment(response: WakanowPaymentResponse): {
  option: WakanowPaymentOption;
  method: WakanowPaymentMethod;
  billingAddress: unknown;
} {
  const paymentModel = response.PaymentResponseModel;
  const option = paymentModel?.PaymentOptions?.find((candidate) => /bank|transfer/i.test(candidate.Name ?? ""));
  const method = option?.PaymentMethods?.find((candidate) => /bank|transfer/i.test(candidate.Name ?? "")) ?? option?.PaymentMethods?.[0];
  if (!option?.Id || !method?.Id) {
    throw new WakanowDirectBookingError("Wakanow did not return a bank transfer payment method", {
      stage: "payment_options",
      details: { response },
    });
  }

  return { option, method, billingAddress: paymentModel?.BillingAddress };
}

function defaultBillingAddress(passenger: Passenger): Record<string, string> {
  return {
    CardHolderName: `${passenger.firstName} ${passenger.lastName}`.trim(),
    Address: "Lagos",
    ZipCode: "100001",
    City: "Lagos",
    State: "Lagos",
    Country: "NG",
  };
}

function parseBankTransfers(paymentModel: WakanowPaymentResponse["PaymentResponseModel"]): BankTransferDetails[] {
  const desc = paymentModel?.PaymentOptions
    ?.flatMap((option) => option.PaymentMethods ?? [])
    .map((method) => method.PaymentDescription ?? "")
    .find((description) => /account number/i.test(description));

  if (!desc) return [];

  const bankMatch = desc.match(/<p[^>]*class="font-weight-medium[^"]*"[^>]*>([^<]+)<\/p>/i) ?? desc.match(/<p[^>]*>([^<]*Bank[^<]*)<\/p>/i);
  const acctMatch = desc.match(/Account Number<\/p>\s*<p[^>]*>(\d+)<\/p>/i);
  const beneficiaryMatch = desc.match(/Beneficiary<\/p>\s*<p[^>]*>([^<]+)<\/p>/i);
  if (!acctMatch) return [];

  return [
    {
      bank: cleanHtmlText(bankMatch?.[1]) ?? "Unknown Bank",
      accountNumber: acctMatch[1],
      beneficiary: cleanHtmlText(beneficiaryMatch?.[1]) ?? "Wakanow.com Collections",
      expiresIn: "9 hours",
      note: "Account details are unique to this transaction. Do not use for other transactions.",
    },
  ];
}

function cleanHtmlText(value: string | undefined): string | undefined {
  const cleaned = value?.replace(/<[^>]+>/g, "").trim();
  return cleaned || undefined;
}

function bookingAuthHeaders(bookingId: string, timestamp: Date): Record<string, string> {
  const bookingAuthSalt = wakanowConfig.bookingAuthSalt;
  if (!bookingAuthSalt) {
    throw new WakanowDirectBookingError("Wakanow booking auth salt is not configured", {
      stage: "submit_booking",
    });
  }

  const timeStamp = timestamp.toISOString();
  const hash = createHash("sha512")
    .update(`${bookingId}${timeStamp}${bookingAuthSalt}`)
    .digest("hex");
  return {
    "X-Auth-Hash": hash,
    "TimeStamp": timeStamp,
  };
}

async function getJson<T = unknown>(input: {
  fetchImpl: WakanowDirectBookingFetch;
  stage: WakanowDirectBookingStage;
  url: string;
  headers?: Record<string, string>;
  safeToFallback?: boolean;
}): Promise<T> {
  return requestJson<T>({
    fetchImpl: input.fetchImpl,
    stage: input.stage,
    url: input.url,
    method: "GET",
    headers: input.headers,
    safeToFallback: input.safeToFallback,
  });
}

async function postJson<T = unknown>(input: {
  fetchImpl: WakanowDirectBookingFetch;
  stage: WakanowDirectBookingStage;
  url: string;
  body: unknown;
  safeToFallback?: boolean;
}): Promise<T> {
  return requestJson<T>({
    fetchImpl: input.fetchImpl,
    stage: input.stage,
    url: input.url,
    method: "POST",
    body: input.body,
    safeToFallback: input.safeToFallback,
  });
}

async function requestJson<T>(input: {
  fetchImpl: WakanowDirectBookingFetch;
  stage: WakanowDirectBookingStage;
  url: string;
  method: "GET" | "POST";
  body?: unknown;
  headers?: Record<string, string>;
  safeToFallback?: boolean;
}): Promise<T> {
  let response: Response;
  try {
    response = await input.fetchImpl(input.url, {
      method: input.method,
      redirect: "manual",
      headers: { ...COMMON_HEADERS, ...input.headers },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      signal: AbortSignal.timeout(wakanowConfig.booking.fetchTimeoutMs),
    });
  } catch (error) {
    throw new WakanowDirectBookingError(error instanceof Error ? error.message : "Wakanow API request failed", {
      stage: input.stage,
      details: {
        url: input.url,
        method: input.method,
        transport: "direct",
      },
      safeToFallback: input.safeToFallback,
    });
  }
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";

  return parseJsonResponse<T>({
    stage: input.stage,
    status: response.status,
    contentType,
    text,
    safeToFallback: input.safeToFallback,
  });
}

function parseJsonResponse<T>(input: {
  stage: WakanowDirectBookingStage;
  status: number;
  contentType: string;
  text: string;
  safeToFallback?: boolean;
  details?: Record<string, unknown>;
}): T {
  const trimmed = input.text.trim();
  const looksJson = /^[{["0-9tfn-]/.test(trimmed);
  if (!input.contentType.includes("json") && !looksJson) {
    throw new WakanowDirectBookingError("Wakanow API returned non-JSON response", {
      stage: input.stage,
      details: { ...input.details, status: input.status, preview: input.text.slice(0, 300) },
      safeToFallback: input.safeToFallback,
    });
  }

  let data: T & { Message?: string };
  try {
    data = JSON.parse(input.text) as T & { Message?: string };
  } catch {
    throw new WakanowDirectBookingError("Wakanow API returned invalid JSON response", {
      stage: input.stage,
      details: { ...input.details, status: input.status, preview: input.text.slice(0, 300) },
      safeToFallback: input.safeToFallback,
    });
  }
  if (input.status < 200 || input.status >= 300) {
    throw new WakanowDirectBookingError(data.Message ?? `Wakanow API request failed with ${input.status}`, {
      stage: input.stage,
      details: { ...input.details, status: input.status, response: data },
      safeToFallback: input.safeToFallback,
    });
  }

  return data;
}

function isVerificationRequired(error: WakanowDirectBookingError): boolean {
  const message = `${error.message} ${JSON.stringify(error.details ?? {})}`;
  return /verification|validate your email|code sent to your email/i.test(message);
}

function proxyFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  return fetch(url, opts);
}
