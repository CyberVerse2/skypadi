import type { DisplayFlightOption, DisplayRankedFlightOptions } from "./flight.types";

export function rankFlightOptionsForDisplay(options: DisplayFlightOption[]): DisplayRankedFlightOptions {
  if (options.length === 0) {
    throw new Error("At least one flight option is required");
  }

  const sortedOptions = dedupeIdenticalFlights(options).sort(compareByStableDisplayOrder);
  const directOptions = sortedOptions.filter((option) => option.stops === 0);
  const recommendationOptions = directOptions.length > 0 ? directOptions : sortedOptions;
  const cheapest = [...recommendationOptions].sort(compareByPriceThenDeparture)[0]!;
  const bestValue = cheapestInWindow(recommendationOptions, 12, 17) ?? cheapest;
  const fastest = [...recommendationOptions].sort(compareByDurationThenPrice)[0]!;
  const evening = cheapestInWindow(recommendationOptions, 17, 24) ?? cheapest;

  return {
    cheapest,
    bestValue,
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
