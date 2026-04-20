import type { FlightSearchResult } from "../schemas/flight-search.js";
import type { CustomerContactProfile } from "../schemas/booking-contract.js";

type Message = { role: "user" | "assistant" | "system"; content: string };

export type PassengerProfile = CustomerContactProfile;

export type LastSearchRequest = {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  searchedAt: number; // Date.now()
};

export type SessionData = {
  history: Message[];
  searchResults?: FlightSearchResult[];
  selectedFlightIndex?: number;
  processing: boolean;
  profile?: PassengerProfile;
  onboarding: boolean; // true = currently collecting profile
  lastSearchRequest?: LastSearchRequest;
  // UX state
  isFirstVisit: boolean;
  searchCount: number;
  failedAttempts: number; // per-flow, reset on success
  lastSeenAt: number; // Date.now()
};

export function defaultSession(): SessionData {
  return {
    history: [],
    processing: false,
    onboarding: false,
    isFirstVisit: true,
    searchCount: 0,
    failedAttempts: 0,
    lastSeenAt: Date.now()
  };
}
