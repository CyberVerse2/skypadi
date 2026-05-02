export type FlightSearchCriteria = {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  passengers: {
    adults: number;
    children?: number;
    infants?: number;
  };
  cabinClass?: string;
  currency: "NGN";
  optimizationPreference?: "cheapest" | "fastest" | "best_value" | "evening";
};

export type FlightOption = {
  id: string;
  supplier: "wakanow";
  supplierOptionId?: string;
  airlineCode?: string;
  airlineName?: string;
  flightNumber?: string;
  origin: string;
  destination: string;
  departureAt: Date;
  arrivalAt: Date;
  durationMinutes?: number;
  stops: number;
  amount: number;
  currency: "NGN";
  recommendationReason?: string;
};

export type RankedFlightOptions = {
  cheapest?: FlightOption;
  bestValue?: FlightOption;
  fastest?: FlightOption;
  evening?: FlightOption;
  options: FlightOption[];
};

export type DisplayFlightOption = {
  id: string;
  airline: string;
  departureTime: string;
  arrivalTime: string;
  durationMinutes: number;
  price: number;
  stops: number;
};

export type DisplayRankedFlightOptions = {
  cheapest: DisplayFlightOption;
  bestValue: DisplayFlightOption;
  morning: DisplayFlightOption;
  afternoon: DisplayFlightOption;
  fastest: DisplayFlightOption;
  evening: DisplayFlightOption;
  options: DisplayFlightOption[];
};
