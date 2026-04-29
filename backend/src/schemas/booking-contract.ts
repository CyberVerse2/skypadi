import type { FlightSearchResult } from "./flight-search.js";

export type CustomerContactProfile = {
  title: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  dateOfBirth: string;
  gender: string;
  phone: string;
  email: string;
};

export type BookingVerificationMode = "internal_contact" | "customer_contact";
export type BookingVerificationStatus = "not_needed" | "automated" | "manual_assist";

export type BookingContactContext = {
  customerEmail: string;
  bookingContactEmail: string;
  verificationMode: BookingVerificationMode;
  verificationStatus: BookingVerificationStatus;
};

export type BankTransferDetails = {
  bank: string;
  accountNumber: string;
  beneficiary: string;
  expiresIn: string;
  note: string;
};

export type ConfirmationEmail = {
  from: string;
  subject: string;
  receivedAt: string;
  preview: string;
};

export type BookingFlightSummary = {
  airline: string;
  departure: string;
  arrival: string;
  departureTime: string;
  arrivalTime: string;
  price: number;
  currency: string;
};

export type BookingPersistenceInput = {
  userId: string;
  profile: CustomerContactProfile;
  selectedFlight?: FlightSearchResult;
  providerBookingId: string;
  status: string;
  paymentUrl?: string;
  amount?: number;
  currency?: string;
  customerEmail?: string;
  bookingContactEmail?: string;
  verificationMode?: BookingVerificationMode;
  verificationStatus?: BookingVerificationStatus;
  bookingEmailAliasId?: number;
  summary?: Partial<BookingFlightSummary>;
  bankTransfers?: BankTransferDetails[];
};
