export type DisplayFlightOption = {
  id: string;
  airline: string;
  departureTime: string;
  price: number;
  stops: number;
  baggageIncluded: boolean;
};

export type DisplayRankedFlightOptions = {
  cheapest: DisplayFlightOption;
  earliest: DisplayFlightOption;
  bestValue: DisplayFlightOption;
  options: DisplayFlightOption[];
};

export function rankFlightOptionsForDisplay(options: DisplayFlightOption[]): DisplayRankedFlightOptions {
  if (options.length === 0) {
    throw new Error("At least one flight option is required");
  }

  const sortedOptions = [...options].sort(compareByStableDisplayOrder);
  const cheapest = [...sortedOptions].sort(compareByPriceThenDeparture)[0]!;
  const earliest = [...sortedOptions].sort(compareByDepartureThenPrice)[0]!;
  const bestValue = [...sortedOptions].sort((left, right) => {
    const scoreDifference = scoreBestValue(left, cheapest.price) - scoreBestValue(right, cheapest.price);

    if (scoreDifference !== 0) {
      return scoreDifference;
    }

    return compareByPriceThenDeparture(left, right);
  })[0]!;

  return {
    cheapest,
    earliest,
    bestValue,
    options: sortedOptions,
  };
}

function compareByStableDisplayOrder(left: DisplayFlightOption, right: DisplayFlightOption): number {
  return compareByDepartureThenPrice(left, right) || left.airline.localeCompare(right.airline) || left.id.localeCompare(right.id);
}

function compareByPriceThenDeparture(left: DisplayFlightOption, right: DisplayFlightOption): number {
  return left.price - right.price || compareByDepartureThenPrice(left, right);
}

function compareByDepartureThenPrice(left: DisplayFlightOption, right: DisplayFlightOption): number {
  return parseDepartureMinutes(left.departureTime) - parseDepartureMinutes(right.departureTime) || left.price - right.price;
}

function scoreBestValue(option: DisplayFlightOption, cheapestPrice: number): number {
  const pricePremiumPercent = cheapestPrice > 0 ? ((option.price - cheapestPrice) / cheapestPrice) * 100 : option.price;
  const stopsPenalty = option.stops * 25;
  const baggagePenalty = option.baggageIncluded ? 0 : 20;
  const rushedMorningPenalty = Math.max(0, 480 - parseDepartureMinutes(option.departureTime)) * 0.1;

  return pricePremiumPercent + stopsPenalty + baggagePenalty + rushedMorningPenalty;
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
