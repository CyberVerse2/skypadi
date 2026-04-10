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

export type SessionData = {
  history: Message[];
  searchResults?: FlightSearchResult[];
  selectedFlightIndex?: number;
  processing: boolean;
  profile?: PassengerProfile;
  onboarding: boolean; // true = currently collecting profile
};

export function defaultSession(): SessionData {
  return {
    history: [],
    processing: false,
    onboarding: false
  };
}
