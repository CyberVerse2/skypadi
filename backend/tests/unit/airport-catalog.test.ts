
import {
  airportByCode,
  nigerianOriginAirports,
  normalizeAirportCode,
  resolveAirport,
  wakanowAirports,
  whatsappOriginRows,
} from "../../src/domain/flight/airport-catalog";
import { describe, expect, test } from "vitest";


describe("unit airport catalog", () => {
  test("airport catalog", async () => {
    expect(wakanowAirports.length > 10).toBeTruthy();
    expect(whatsappOriginRows.length).toBe(10);
    for (const id of ["origin:LOS", "origin:ABV", "origin:PHC", "origin:KAN", "origin:ENU"]) {
      expect(whatsappOriginRows.some((row) => row.id === id)).toBeTruthy();
    }
    expect(nigerianOriginAirports.length >= 10).toBeTruthy();
    expect(airportByCode("ENU")?.city).toBe("Enugu");
    expect(airportByCode("PHC")?.city).toBe("Port Harcourt");
    expect(airportByCode("LAG")?.code).toBe("LOS");
    expect(airportByCode("ABU")?.code).toBe("ABV");
    expect(normalizeAirportCode("lag")).toBe("LOS");
    expect(normalizeAirportCode("abu")).toBe("ABV");
    expect(resolveAirport("lagos")?.code).toBe("LOS");
    expect(resolveAirport("abuja")?.code).toBe("ABV");
    expect(resolveAirport("Accra")?.code).toBe("ACC");
    expect(resolveAirport("Heathrow Airport")?.code).toBe("LHR");
    expect(airportByCode("xxx")).toBe(undefined);
    expect(resolveAirport("xxx")).toBe(undefined);

    console.log("airport catalog tests passed");
  });
});
