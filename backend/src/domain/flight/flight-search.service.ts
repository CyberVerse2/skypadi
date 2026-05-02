import type { DisplayFlightOption, DisplayRankedFlightOptions } from "./flight.types";

export function rankFlightOptionsForDisplay(options: DisplayFlightOption[]): DisplayRankedFlightOptions {
  if (options.length === 0) {
    throw new Error("At least one flight option is required");
  }

  const sortedOptions = dedupeIdenticalFlights(options).sort(compareByStableDisplayOrder);
  const directOptions = sortedOptions.filter((option) => option.stops === 0);
  const recommendationOptions = directOptions.length > 0 ? directOptions : sortedOptions;
  const cheapest = [...recommendationOptions].sort(compareByPriceThenDeparture)[0]!;
  const morning = cheapestInWindow(recommendationOptions, 5, 12) ?? cheapest;
  const afternoon = cheapestInWindow(recommendationOptions, 12, 17) ?? cheapest;
  const fastest = [...recommendationOptions].sort(compareByDurationThenPrice)[0]!;
  const evening = cheapestInWindow(recommendationOptions, 17, 24) ?? cheapest;
  const bestValue = bestValueByTradeoff({ cheapest, morning, afternoon, evening, fastest });

  return {
    cheapest,
    bestValue,
    morning,
    afternoon,
    fastest,
    evening,
    options: recommendationOptions,
  };
}

function dedupeIdenticalFlights(options: DisplayFlightOption[]): DisplayFlightOption[] {
  const selected = new Map<string, DisplayFlightOption>();
  for (const option of [...options].sort(compareByPriceThenDeparture)) {
    const key = [
      option.airline.trim().toLowerCase(),
      option.departureTime,
      option.arrivalTime,
      option.stops,
    ].join("|");
    if (!selected.has(key)) selected.set(key, option);
  }
  return [...selected.values()];
}

function compareByStableDisplayOrder(left: DisplayFlightOption, right: DisplayFlightOption): number {
  return compareByPriceThenDeparture(left, right) || left.airline.localeCompare(right.airline) || left.id.localeCompare(right.id);
}

function compareByPriceThenDeparture(left: DisplayFlightOption, right: DisplayFlightOption): number {
  return left.price - right.price || compareByDepartureThenPrice(left, right);
}

function compareByDepartureThenPrice(left: DisplayFlightOption, right: DisplayFlightOption): number {
  return parseDepartureMinutes(left.departureTime) - parseDepartureMinutes(right.departureTime) || left.price - right.price;
}

function compareByDurationThenPrice(left: DisplayFlightOption, right: DisplayFlightOption): number {
  return left.durationMinutes - right.durationMinutes || compareByPriceThenDeparture(left, right);
}

function cheapestInWindow(options: DisplayFlightOption[], startHour: number, endHour: number): DisplayFlightOption | undefined {
  return options
    .filter((option) => {
      const minutes = parseDepartureMinutes(option.departureTime);
      return minutes >= startHour * 60 && minutes < endHour * 60;
    })
    .sort(compareByPriceThenDeparture)[0];
}

function bestValueByTradeoff(input: {
  cheapest: DisplayFlightOption;
  morning: DisplayFlightOption;
  afternoon: DisplayFlightOption;
  evening: DisplayFlightOption;
  fastest: DisplayFlightOption;
}): DisplayFlightOption {
  if (isSensibleMorning(input.cheapest)) {
    return input.cheapest;
  }

  const afternoonPremium = input.afternoon.price - input.cheapest.price;
  if (
    input.afternoon.id !== input.cheapest.id
    && isPrimeAfternoon(input.afternoon)
    && isEarlyMorning(input.cheapest)
    && afternoonPremium >= 0
    && afternoonPremium <= 5_000
  ) {
    return input.afternoon;
  }

  if (input.fastest.id !== input.cheapest.id) {
    const fastestPremium = input.fastest.price - input.cheapest.price;
    const durationSaved = input.cheapest.durationMinutes - input.fastest.durationMinutes;
    if (durationSaved >= 20 && fastestPremium >= 0 && fastestPremium <= 5_000) {
      return input.fastest;
    }
  }

  return input.cheapest;
}

function isEarlyMorning(option: DisplayFlightOption): boolean {
  const minutes = parseDepartureMinutes(option.departureTime);
  return minutes >= 5 * 60 && minutes < 10 * 60;
}

function isSensibleMorning(option: DisplayFlightOption): boolean {
  const minutes = parseDepartureMinutes(option.departureTime);
  return minutes >= 10 * 60 && minutes < 12 * 60;
}

function isPrimeAfternoon(option: DisplayFlightOption): boolean {
  const minutes = parseDepartureMinutes(option.departureTime);
  return minutes >= 12 * 60 && minutes < 15 * 60;
}

function parseDepartureMinutes(departureTime: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(departureTime);

  if (!match) {
    throw new Error(`Invalid departure time: ${departureTime}`);
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours > 23 || minutes > 59) {
    throw new Error(`Invalid departure time: ${departureTime}`);
  }

  return hours * 60 + minutes;
}
