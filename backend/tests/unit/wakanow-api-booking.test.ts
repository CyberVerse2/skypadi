
import { beforeEach, describe, expect, test } from "vitest";

import {
  bookFlightWithWakanowApi,
  WakanowDirectBookingError,
} from "../../src/integrations/wakanow/api-booking";
import type { WakanowDirectBookingFetch } from "../../src/integrations/wakanow/wakanow.types";
import { env } from "../../src/config";
import type { Passenger } from "../../src/schemas/flight-booking";


describe("unit wakanow api booking", () => {
  beforeEach(() => {
    env.WAKANOW_BOOKING_AUTH_SALT = "test-booking-auth-salt";
  });

  test("Wakanow direct API booking creates a pending-payment booking without browser automation", async () => {
    expect.hasAssertions();
    const requests: Array<{ url: string; method: string; redirect?: RequestRedirect; body?: unknown; headers: Record<string, string> }> = [];
    const fetchImpl: WakanowDirectBookingFetch = async (url, init = {}) => {
      const headers = Object.fromEntries(new Headers(init.headers).entries());
      requests.push({
        url: String(url),
        method: init.method ?? "GET",
        redirect: init.redirect,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
        headers,
      });

      if (String(url).endsWith("/api/flights/Select/")) {
        return jsonResponse({
          SearchKey: "search_123",
          SelectFlightResult: {
            BookingId: "987654",
            SelectData: { selected: true },
            IsPassportRequired: false,
          },
        });
      }

      if (String(url).endsWith("/api/booking/Booking/Validate")) {
        return jsonResponse({ Status: "OK" });
      }

      if (String(url).endsWith("/api/booking/Booking/Booking/987654")) {
        return jsonResponse({ BookingId: "987654", Status: "Pending" });
      }

      if (String(url).endsWith("/api/booking/Payment/Get/987654/Flight")) {
        return jsonResponse({
          PaymentResponseModel: {
            BookingId: "987654",
            TotalPrice: { Amount: 158000, CurrencyCode: "NGN" },
            BillingAddress: { AddressLine1: "Lagos", City: "Lagos" },
            PaymentOptions: [
              {
                Id: 10,
                Name: "Bank Transfer",
                IsCorporateCheckout: false,
                PaymentMethods: [
                  {
                    Id: 22,
                    Name: "Bank Transfer",
                    PaymentDescription:
                      '<p class="font-weight-medium">Providus Bank</p><p>Account Number</p><p>1234567890</p><p>Beneficiary</p><p>Wakanow.com Collections</p>',
                  },
                ],
              },
            ],
          },
        });
      }

      if (String(url).endsWith("/api/booking/Booking/GeneratePNR/987654")) {
        return jsonResponse({ Status: "OK" });
      }

      if (String(url).endsWith("/api/booking/Payment/MakePayment")) {
        return jsonResponse({
          PaymentResponseModel: {
            BookingId: "987654",
            TotalPrice: { Amount: 158000, CurrencyCode: "NGN" },
            PaymentOptions: [
              {
                Name: "Bank Transfer",
                PaymentMethods: [
                  {
                    PaymentDescription:
                      '<p class="font-weight-medium">Providus Bank</p><p>Account Number</p><p>1234567890</p><p>Beneficiary</p><p>Wakanow.com Collections</p>',
                  },
                ],
              },
            ],
          },
        });
      }

      throw new Error(`unexpected request ${String(url)}`);
    };

    const result = await bookFlightWithWakanowApi(
      {
        searchKey: "search_123",
        flightId: "flight_abc",
        passenger: samplePassenger(),
        contactEmail: "book_abc@bookings.wakanow.com",
        bookingId: "skypadi_booking_1",
      },
      { fetchImpl, now: () => new Date("2026-05-01T12:00:00.000Z") },
    );

    expect(result.bookingId).toBe("987654");
    expect(result.status).toBe("pending_payment");
    expect(result.flightSummary.price).toBe(158000);
    expect(result.bankTransfers?.[0]?.bank).toBe("Providus Bank");
    expect(result.bankTransfers?.[0]?.accountNumber).toBe("1234567890");
    expect(result.bankTransfers?.[0]?.beneficiary).toBe("Wakanow.com Collections");

    const selectRequest = requests.find((request) => request.url.endsWith("/api/flights/Select/"));
    expect(selectRequest?.body).toEqual({
      SearchKey: "search_123",
      FlightId: "flight_abc",
      TargetCurrency: "NGN",
    });
    expect(selectRequest?.redirect).toBe("manual");

    const validateRequest = requests.find((request) => request.url.endsWith("/api/booking/Booking/Validate"));
    const validateBody = validateRequest?.body as Record<string, any> | undefined;
    expect(validateBody?.BookingId).toBe("987654");
    expect(validateBody?.BookingItemModels).toEqual([
      {
        ProductType: "Flight",
        BookingData: { selected: true },
        TargetCurrency: "NGN",
      },
    ]);
    expect(validateBody?.PassengerDetails?.[0]?.Email).toBe("book_abc@bookings.wakanow.com");

    const submitRequest = requests.find((request) => request.url.endsWith("/api/booking/Booking/Booking/987654"));
    expect(submitRequest?.headers["x-auth-hash"]).toBe("a7f16b10eb44461406b6467d2292543a833202e6e6dd4342ec217620a03a01d7f0c0c8587984c093b72f898fdf180f61c610af30cd571e66415b0456994bf730");
    expect(submitRequest?.headers["timestamp"]).toBe("2026-05-01T12:00:00.000Z");

    const paymentRequest = requests.find((request) => request.url.endsWith("/api/booking/Payment/MakePayment"));
    expect(paymentRequest?.body).toEqual({
      BookingId: "987654",
      CallbackUrl: "https://www.wakanow.com/en-ng/booking/987654/confirmation?products=Flight",
      PaymentOptionId: 10,
      PaymentMethodId: 22,
      BillingAddress: { AddressLine1: "Lagos", City: "Lagos" },
      IsCorporateCheckout: false,
    });
  });

  test("Wakanow direct API booking fails closed when booking auth salt is absent", async () => {
    expect.hasAssertions();
    env.WAKANOW_BOOKING_AUTH_SALT = undefined;
    const fetchImpl: WakanowDirectBookingFetch = async (url) => {
      if (String(url).endsWith("/api/flights/Select/")) {
        return jsonResponse({
          BookingId: "2605010405376",
          SelectData: { selected: true },
        });
      }
      if (String(url).endsWith("/api/booking/Booking/Validate")) return jsonResponse({});
      throw new Error(`unexpected request ${String(url)}`);
    };

    await expect(bookFlightWithWakanowApi(
        {
          searchKey: "search_123",
          flightId: "flight_abc",
          passenger: samplePassenger(),
          contactEmail: "book_abc@bookings.wakanow.com",
        },
        { fetchImpl },
      )).rejects.toSatisfy((error) =>
        error instanceof WakanowDirectBookingError
        && error.stage === "submit_booking"
        && error.message === "Wakanow booking auth salt is not configured");
  });

  test("Wakanow direct API booking persists supplier state and can resume after select", async () => {
    expect.hasAssertions();
    const states: unknown[] = [];
    const urls: string[] = [];
    const fetchImpl: WakanowDirectBookingFetch = async (url) => {
      urls.push(String(url));
      if (String(url).endsWith("/api/flights/Select/")) {
        return jsonResponse({
          BookingId: "2605010405376",
          SelectData: { selected: "persist-me" },
        });
      }
      if (String(url).endsWith("/api/booking/Booking/Validate")) return jsonResponse("2605010405376");
      if (String(url).endsWith("/api/booking/Booking/Booking/2605010405376")) return jsonResponse({});
      if (String(url).endsWith("/api/booking/Payment/Get/2605010405376/Flight")) return paymentModelResponse("2605010405376");
      if (String(url).endsWith("/api/booking/Booking/GeneratePNR/2605010405376")) return jsonResponse({});
      if (String(url).endsWith("/api/booking/Payment/MakePayment")) return paymentModelResponse("2605010405376");
      throw new Error(`unexpected request ${String(url)}`);
    };

    await bookFlightWithWakanowApi(
      {
        searchKey: "search_123",
        flightId: "flight_abc",
        passenger: samplePassenger(),
        contactEmail: "book_abc@bookings.wakanow.com",
      },
      {
        fetchImpl,
        onStateChange: async (state) => {
          states.push(state);
        },
      },
    );

    expect(states[0]).toEqual({
      supplierBookingId: "2605010405376",
      selectData: { selected: "persist-me" },
      stage: "selected",
    });
    expect(states.at(-1)).toEqual({
      supplierBookingId: "2605010405376",
      selectData: { selected: "persist-me" },
      bankTransfers: [{
        bank: "Providus Bank",
        accountNumber: "1234567890",
        beneficiary: "Wakanow.com Collections",
        expiresIn: "9 hours",
        note: "Account details are unique to this transaction. Do not use for other transactions.",
      }],
      stage: "payment_pending",
    });

    const resumedUrls: string[] = [];
    const resumedFetch: WakanowDirectBookingFetch = async (url) => {
      resumedUrls.push(String(url));
      if (String(url).endsWith("/api/flights/Select/")) {
        throw new Error("resume should not select again");
      }
      if (String(url).endsWith("/api/booking/Booking/Validate")) return jsonResponse("2605010405376");
      if (String(url).endsWith("/api/booking/Booking/Booking/2605010405376")) return jsonResponse({});
      if (String(url).endsWith("/api/booking/Payment/Get/2605010405376/Flight")) return paymentModelResponse("2605010405376");
      if (String(url).endsWith("/api/booking/Booking/GeneratePNR/2605010405376")) return jsonResponse({});
      if (String(url).endsWith("/api/booking/Payment/MakePayment")) return paymentModelResponse("2605010405376");
      throw new Error(`unexpected request ${String(url)}`);
    };

    await bookFlightWithWakanowApi(
      {
        searchKey: "search_123",
        flightId: "flight_abc",
        passenger: samplePassenger(),
        contactEmail: "book_abc@bookings.wakanow.com",
        supplierState: {
          supplierBookingId: "2605010405376",
          selectData: { selected: "persist-me" },
        },
      },
      { fetchImpl: resumedFetch },
    );

    expect(urls.some((url) => url.endsWith("/api/flights/Select/"))).toBe(true);
    expect(resumedUrls.some((url) => url.endsWith("/api/flights/Select/"))).toBe(false);
  });

  test("Wakanow direct API booking retries validation with supplier email OTP when required", async () => {
    expect.hasAssertions();
    const validateBodies: unknown[] = [];
    const consumed: string[] = [];
    let validateAttempts = 0;

    const fetchImpl: WakanowDirectBookingFetch = async (url, init = {}) => {
      if (String(url).endsWith("/api/flights/Select/")) {
        return jsonResponse({
          SearchKey: "search_123",
          SelectFlightResult: { BookingId: "987654", SelectData: { selected: true } },
        });
      }

      if (String(url).endsWith("/api/booking/Booking/Validate")) {
        validateAttempts += 1;
        validateBodies.push(JSON.parse(String(init.body)));
        if (validateAttempts === 1) {
          return jsonResponse(
            {
              Message:
                "Sorry, you need to validate your email address by entering the verification code sent to your email address below!",
            },
            { status: 400 },
          );
        }
        return jsonResponse({ Status: "OK" });
      }

      if (String(url).endsWith("/api/booking/Booking/Booking/987654")) return jsonResponse({});
      if (String(url).endsWith("/api/booking/Payment/Get/987654/Flight")) return paymentModelResponse();
      if (String(url).endsWith("/api/booking/Booking/GeneratePNR/987654")) return jsonResponse({});
      if (String(url).endsWith("/api/booking/Payment/MakePayment")) return paymentModelResponse();

      throw new Error(`unexpected request ${String(url)}`);
    };

    await bookFlightWithWakanowApi(
      {
        searchKey: "search_123",
        flightId: "flight_abc",
        passenger: samplePassenger(),
        contactEmail: "book_abc@bookings.wakanow.com",
        resolveOtp: async ({ customerEmail, contactEmail }) => {
          expect(customerEmail).toBe("ada@example.com");
          expect(contactEmail).toBe("book_abc@bookings.wakanow.com");
          return {
            code: "493821",
            consume: async () => {
              consumed.push("493821");
            },
          };
        },
      },
      { fetchImpl },
    );

    expect(validateAttempts).toBe(2);
    expect((validateBodies[1] as Record<string, unknown> | undefined)?.VerificationCode).toBe("493821");
    expect(consumed).toEqual(["493821"]);
  });

  test("Wakanow direct API booking accepts top-level select response shape", async () => {
    expect.hasAssertions();
    const fetchImpl: WakanowDirectBookingFetch = async (url) => {
      if (String(url).endsWith("/api/flights/Select/")) {
        return jsonResponse({
          SearchKey: "search_123",
          BookingId: "2605010405203",
          SelectData: { selected: "top-level" },
          IsPassportRequired: false,
        });
      }

      if (String(url).endsWith("/api/booking/Booking/Validate")) return jsonResponse({ Status: "OK" });
      if (String(url).endsWith("/api/booking/Booking/Booking/2605010405203")) return jsonResponse({});
      if (String(url).endsWith("/api/booking/Payment/Get/2605010405203/Flight")) return paymentModelResponse("2605010405203");
      if (String(url).endsWith("/api/booking/Booking/GeneratePNR/2605010405203")) return jsonResponse({});
      if (String(url).endsWith("/api/booking/Payment/MakePayment")) return paymentModelResponse("2605010405203");

      throw new Error(`unexpected request ${String(url)}`);
    };

    const result = await bookFlightWithWakanowApi(
      {
        searchKey: "search_123",
        flightId: "flight_abc",
        passenger: samplePassenger(),
        contactEmail: "book_abc@bookings.wakanow.com",
      },
      { fetchImpl },
    );

    expect(result.bookingId).toBe("2605010405203");
  });

  test("Wakanow direct API booking accepts string validate success response", async () => {
    expect.hasAssertions();
    const fetchImpl: WakanowDirectBookingFetch = async (url) => {
      if (String(url).endsWith("/api/flights/Select/")) {
        return jsonResponse({
          BookingId: "2605010405374",
          SelectData: { selected: true },
        });
      }

      if (String(url).endsWith("/api/booking/Booking/Validate")) return jsonResponse("2605010405374");
      if (String(url).endsWith("/api/booking/Booking/Booking/2605010405374")) return jsonResponse({});
      if (String(url).endsWith("/api/booking/Payment/Get/2605010405374/Flight")) return paymentModelResponse("2605010405374");
      if (String(url).endsWith("/api/booking/Booking/GeneratePNR/2605010405374")) return jsonResponse({});
      if (String(url).endsWith("/api/booking/Payment/MakePayment")) return paymentModelResponse("2605010405374");

      throw new Error(`unexpected request ${String(url)}`);
    };

    const result = await bookFlightWithWakanowApi(
      {
        searchKey: "search_123",
        flightId: "flight_abc",
        passenger: samplePassenger(),
        contactEmail: "book_abc@bookings.wakanow.com",
      },
      { fetchImpl },
    );

    expect(result.bookingId).toBe("2605010405374");
  });

  test("Wakanow direct API booking sends a default Nigerian billing address when supplier omits one", async () => {
    expect.hasAssertions();
    let paymentBody: Record<string, unknown> | undefined;
    const fetchImpl: WakanowDirectBookingFetch = async (url, init = {}) => {
      if (String(url).endsWith("/api/flights/Select/")) {
        return jsonResponse({
          BookingId: "2605010405375",
          SelectData: { selected: true },
        });
      }

      if (String(url).endsWith("/api/booking/Booking/Validate")) return jsonResponse("2605010405375");
      if (String(url).endsWith("/api/booking/Booking/Booking/2605010405375")) return jsonResponse({});
      if (String(url).endsWith("/api/booking/Payment/Get/2605010405375/Flight")) {
        return jsonResponse({
          PaymentResponseModel: {
            BookingId: "2605010405375",
            TotalPrice: { Amount: 158000, CurrencyCode: "NGN" },
            PaymentOptions: [
              {
                Id: 2,
                Name: "Bank Transfer Payment (Instant Ticketing)",
                IsCorporateCheckout: false,
                PaymentMethods: [
                  {
                    Id: 100,
                    Name: "Automated Bank Transfers",
                    PaymentDescription: "Account Number</p><p>1234567890</p>",
                  },
                ],
              },
            ],
          },
        });
      }
      if (String(url).endsWith("/api/booking/Booking/GeneratePNR/2605010405375")) return jsonResponse({});
      if (String(url).endsWith("/api/booking/Payment/MakePayment")) {
        paymentBody = JSON.parse(String(init.body));
        return paymentModelResponse("2605010405375");
      }

      throw new Error(`unexpected request ${String(url)}`);
    };

    await bookFlightWithWakanowApi(
      {
        searchKey: "search_123",
        flightId: "flight_abc",
        passenger: samplePassenger(),
        contactEmail: "book_abc@bookings.wakanow.com",
      },
      { fetchImpl },
    );

    expect(paymentBody?.BillingAddress).toEqual({
      CardHolderName: "Ada Lovelace",
      Address: "Lagos",
      ZipCode: "100001",
      City: "Lagos",
      State: "Lagos",
      Country: "NG",
    });
    expect(paymentBody?.CallbackUrl).toBe("https://www.wakanow.com/en-ng/booking/2605010405375/confirmation?products=Flight");
  });

  test("Wakanow direct API booking marks non-JSON supplier challenges as safe to fall back", async () => {
    expect.hasAssertions();
    const fetchImpl: WakanowDirectBookingFetch = async () =>
      new Response("<html>Loading</html>", {
        status: 307,
        headers: { "content-type": "text/html" },
      });

    await expect(
      bookFlightWithWakanowApi(
        {
          searchKey: "search_123",
          flightId: "flight_abc",
          passenger: samplePassenger(),
          contactEmail: "book_abc@bookings.wakanow.com",
        },
        { fetchImpl },
      ),
    ).rejects.toSatisfy((error) => error instanceof WakanowDirectBookingError && error.safeToFallback === true && error.stage === "select");
  });

  function samplePassenger(): Passenger {
    return {
      title: "Mr",
      firstName: "Ada",
      middleName: undefined,
      lastName: "Lovelace",
      dateOfBirth: "1990-01-15",
      nationality: "Nigerian",
      gender: "Female",
      phone: "08012345678",
      email: "ada@example.com",
    };
  }

  function paymentModelResponse(bookingId = "987654"): Response {
    return jsonResponse({
      PaymentResponseModel: {
        BookingId: bookingId,
        TotalPrice: { Amount: 158000, CurrencyCode: "NGN" },
        PaymentOptions: [
          {
            Id: 10,
            Name: "Bank Transfer",
            PaymentMethods: [{
              Id: 22,
              Name: "Bank Transfer",
              PaymentDescription:
                '<p class="font-weight-medium">Providus Bank</p><p>Account Number</p><p>1234567890</p><p>Beneficiary</p><p>Wakanow.com Collections</p>',
            }],
          },
        ],
      },
    });
  }

  function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
    return new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { "content-type": "application/json", ...init.headers },
    });
  }
});
