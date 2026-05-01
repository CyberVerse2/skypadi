import type { DisplayFlightOption, DisplayRankedFlightOptions } from "./flight.types";

export function rankFlightOptionsForDisplay(options: DisplayFlightOption[]): DisplayRankedFlightOptions {
  if (options.length === 0) {
    throw new Error("At least one flight option is required");
  }

  const sortedOptions = [...options].sort(compareByStableDisplayOrder);
  const cheapest = [...sortedOptions].sort(compareByPriceThenDeparture)[0]!;
  const bestValue = cheapestInWindow(sortedOptions, 12, 18) ?? cheapest;
  const fastest = [...sortedOptions].sort(compareByDurationThenPrice)[0]!;
  const evening = cheapestInWindow(sortedOptions, 18, 24) ?? cheapest;

  return {
    cheapest,
    bestValue,
    fastest,
    evening,
    options: sortedOptions,
  };
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
