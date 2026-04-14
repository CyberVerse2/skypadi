import type { FlightSearchResult } from "../schemas/flight-search.js";

type Message = { role: "user" | "assistant" | "system"; content: string };

export type PassengerProfile = {
  title: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  dateOfBirth: string;
  gender: string;
  phone: string;
  email: string;
};

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
