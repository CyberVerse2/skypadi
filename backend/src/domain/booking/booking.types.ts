import type { Passenger } from "../../schemas/flight-booking";
import type {
  SupplierBookingJobPayload,
  SupplierBookingJobRecord,
  SupplierBookingJobRepository,
} from "../../jobs/booking-job.types";

export const bookingStatuses = [
  "draft",
  "priced",
  "passenger_details_collected",
  "payment_pending",
  "payment_confirmed",
  "supplier_hold_pending",
  "supplier_hold_created",
  "awaiting_payment_for_hold",
  "supplier_booking_pending",
  "supplier_verification_required",
  "issued",
  "hold_expired",
  "failed",
  "cancelled",
  "manual_review_required",
] as const;

export type BookingStatus = (typeof bookingStatuses)[number];

export type BookingDraft = {
  id: string;
  userId: string;
  conversationId: string;
  selectedFlightOptionId: string;
  status: BookingStatus;
  bookingEmailAlias: string;
  createdAt: Date;
};

export type CreateBookingDraftRecord = {
  id: string;
  userId: string;
  conversationId: string;
  selectedFlightOptionId: string;
  status: BookingStatus;
  bookingEmailAlias: string;
  aliasLocalPart: string;
  aliasDomain: string;
  createdAt: Date;
};

export type BookingRepository = {
  createDraft(input: CreateBookingDraftRecord): Promise<BookingDraft>;
  findActiveBookingForPassengerCollection(input: {
    userId: string;
    conversationId: string;
  }): Promise<ActiveBookingForPassengerCollection | undefined>;
};

export type PassengerRepository = {
  findDefaultPassengerForUser(userId: string): Promise<SavedPassenger | undefined>;
};

export type BookingPassengerRepository = {
  collectPassengerDetails(input: CollectedPassengerDetails): Promise<void>;
  collectSavedPassengerDetails(input: CollectedSavedPassengerDetails): Promise<void>;
};

export type SavedPassenger = {
  id: string;
  passenger: Passenger;
};

export type ActiveBookingForPassengerCollection = {
  id: string;
  userId: string;
  conversationId: string;
  selectedFlightOptionId: string;
  bookingEmailAlias: string;
  status: BookingStatus;
};

export type CollectedPassengerDetails = {
  bookingId: string;
  userId: string;
  conversationId: string;
  passenger: Passenger;
  supplierContactEmail: string;
  collectedAt: Date;
};

export type CollectedSavedPassengerDetails = CollectedPassengerDetails & {
  passengerId: string;
};

export type CreateBookingDraftInput = {
  userId: string;
  conversationId: string;
  selectedFlightOptionId: string;
  inboundDomain: string;
  now?: Date;
  idGenerator?: () => string;
  aliasTokenGenerator?: () => string;
  repository: BookingRepository;
};

export type QueueSupplierBookingInput = {
  userId: string;
  conversationId: string;
  passenger?: Passenger;
  repository?: BookingRepository & Pick<BookingPassengerRepository, "collectPassengerDetails">;
  jobRepository?: SupplierBookingJobRepository;
  enqueueSupplierBooking?: (payload: SupplierBookingJobPayload) => Promise<void>;
  now?: Date;
};

export type QueueSavedPassengerSupplierBookingInput = {
  userId: string;
  conversationId: string;
  repository?: BookingRepository;
  passengerRepository?: PassengerRepository;
  bookingPassengerRepository?: BookingPassengerRepository;
  jobRepository?: SupplierBookingJobRepository;
  enqueueSupplierBooking?: (payload: SupplierBookingJobPayload) => Promise<void>;
  now?: Date;
};

export type QueuedSupplierBooking = {
  bookingId: string;
  status: "supplier_booking_pending";
  job: SupplierBookingJobRecord;
};

const terminalBookingStatuses = new Set<BookingStatus>([
  "issued",
  "hold_expired",
  "failed",
  "cancelled",
  "manual_review_required",
]);

export function isTerminalBookingStatus(status: BookingStatus): boolean {
  return terminalBookingStatuses.has(status);
}
