import { describe, expect, it, vi } from "vitest";
import { searchFlightsApi } from "../../src/integrations/wakanow/api-search";

describe("searchFlightsApi", () => {
  it("sends a second swapped itinerary leg for return searches", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify("return-search-key"), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            HasResult: true,
            SearchFlightResults: [
              {
                FlightId: "flight-1",
                FlightCombination: {
                  Flights: [
                    {
                      AirlineName: "Test Air",
                      Airline: "TA",
                      DepartureCode: "LOS",
                      DepartureName: "Lagos",
                      DepartureTime: "2026-06-10T09:00:00",
                      ArrivalCode: "DXB",
                      ArrivalName: "Dubai",
                      ArrivalTime: "2026-06-10T17:00:00",
                      Stops: 0,
                      TripDuration: "08:00:00",
                    },
                  ],
                  Price: { Amount: 123456, CurrencyCode: "NGN" },
                  Source: "test",
                },
              },
            ],
          }),
          { status: 200 }
        )
      );

    vi.stubGlobal("fetch", fetchMock);

    await searchFlightsApi({
      origin: "LOS",
      destination: "DXB",
      departureDate: "2026-06-10",
      returnDate: "2026-06-17",
      maxResults: 1,
    });

    const createSearchCall = fetchMock.mock.calls[0];
    const body = JSON.parse(createSearchCall[1].body);
    const flightRequestView = JSON.parse(body.FlightRequestView);

    expect(body.FlightSearchType).toBe("Return");
    expect(body.Itineraries).toEqual([
      expect.objectContaining({
        Departure: "LOS",
        Destination: "DXB",
        DepartureDate: "6/10/2026",
      }),
      expect.objectContaining({
        Departure: "DXB",
        Destination: "LOS",
        DepartureDate: "6/17/2026",
      }),
    ]);
    expect(flightRequestView.Itineraries).toEqual(body.Itineraries);
  });
});
