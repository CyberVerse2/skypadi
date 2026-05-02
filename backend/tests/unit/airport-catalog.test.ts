
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
  test("keeps the WhatsApp origin list broad enough for Nigerian domestic search", () => {
    expect.hasAssertions();

    expect(wakanowAirports.length > 10).toBeTruthy();
    expect(whatsappOriginRows.length).toBe(10);
    expect(nigerianOriginAirports.length >= 10).toBeTruthy();
  });

  test.each(["origin:LOS", "origin:ABV", "origin:PHC", "origin:KAN", "origin:ENU"])(
    "includes %s in the WhatsApp origin picker",
    (id) => {
      expect.hasAssertions();

      expect(whatsappOriginRows.some((row) => row.id === id)).toBe(true);
    },
  );

  test.each([
    ["ENU", "Enugu"],
    ["PHC", "Port Harcourt"],
  ])("maps airport code %s to city %s", (code, city) => {
    expect.hasAssertions();

    expect(airportByCode(code)?.city).toBe(city);
  });

  test.each([
    ["LAG", "LOS"],
    ["ABU", "ABV"],
    ["lag", "LOS"],
    ["abu", "ABV"],
  ])("normalizes alias %s to %s", (input, code) => {
    expect.hasAssertions();

    expect(normalizeAirportCode(input)).toBe(code);
  });

  test.each([
    ["lagos", "LOS"],
    ["abuja", "ABV"],
    ["Accra", "ACC"],
    ["Heathrow Airport", "LHR"],
  ])("resolves %s to %s", (input, code) => {
    expect.hasAssertions();

    expect(resolveAirport(input)?.code).toBe(code);
  });

  test("returns undefined for unknown airports", () => {
    expect.hasAssertions();

    expect(airportByCode("xxx")).toBe(undefined);
    expect(resolveAirport("xxx")).toBe(undefined);
  });
});
