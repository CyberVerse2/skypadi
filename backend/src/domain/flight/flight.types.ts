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
  optimizationPreference?: "cheapest" | "earliest" | "best_value";
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
  earliest?: FlightOption;
  bestValue?: FlightOption;
  options: FlightOption[];
};
