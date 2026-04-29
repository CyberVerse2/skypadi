import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const skypadi = pgSchema("skypadi_whatsapp");

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const bookingStatusEnum = skypadi.enum("booking_status", [
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
]);

export const paymentStatusEnum = skypadi.enum("payment_status", [
  "pending",
  "proof_uploaded",
  "confirmed",
  "failed",
  "expired",
  "refunded",
  "manual_review_required",
]);

export const inboundEmailClassificationEnum = skypadi.enum("inbound_email_classification", [
  "verification_code",
  "booking_confirmation",
  "payment_or_receipt",
  "supplier_change",
  "other",
]);

export const conversationStatusEnum = skypadi.enum("conversation_status", [
  "collecting_trip_details",
  "presenting_flight_options",
  "collecting_passenger_details",
  "awaiting_payment_choice",
  "awaiting_payment_confirmation",
  "issuing_supplier_booking",
  "awaiting_supplier_verification",
  "ticket_issued",
  "manual_review_required",
]);

export const conversationMessageDirectionEnum = skypadi.enum("conversation_message_direction", [
  "inbound",
  "outbound",
  "system",
]);

export const bookingEmailAliasStatusEnum = skypadi.enum("booking_email_alias_status", [
  "active",
  "used",
  "expired",
  "disabled",
]);

export const users = skypadi.table(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    displayName: text("display_name"),
    locale: text("locale"),
    timezone: text("timezone"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    ...timestamps,
  },
);

export const whatsappContacts = skypadi.table(
  "whatsapp_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    phoneNumber: text("phone_number").notNull(),
    profileName: text("profile_name"),
    waId: text("wa_id"),
    isPrimary: boolean("is_primary").notNull().default(true),
    ...timestamps,
  },
  (table) => ({
    phoneNumberIdx: uniqueIndex("whatsapp_contacts_phone_number_idx").on(table.phoneNumber),
    userIdIdx: index("whatsapp_contacts_user_id_idx").on(table.userId),
  }),
);

export const conversations = skypadi.table(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    whatsappContactId: uuid("whatsapp_contact_id").references(() => whatsappContacts.id, { onDelete: "set null" }),
    status: conversationStatusEnum("status").notNull().default("collecting_trip_details"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    ...timestamps,
  },
  (table) => ({
    userIdIdx: index("conversations_user_id_idx").on(table.userId),
    statusIdx: index("conversations_status_idx").on(table.status),
  }),
);

export const conversationMessages = skypadi.table(
  "conversation_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    direction: conversationMessageDirectionEnum("direction").notNull(),
    providerMessageId: text("provider_message_id"),
    textBody: text("text_body"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => ({
    conversationIdIdx: index("conversation_messages_conversation_id_idx").on(table.conversationId),
    providerMessageIdIdx: uniqueIndex("conversation_messages_provider_message_id_idx").on(table.providerMessageId),
  }),
);

export const userPreferences = skypadi.table(
  "user_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    homeAirportCode: text("home_airport_code"),
    preferredCurrency: text("preferred_currency").notNull().default("NGN"),
    preferences: jsonb("preferences").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    ...timestamps,
  },
  (table) => ({
    userIdIdx: uniqueIndex("user_preferences_user_id_idx").on(table.userId),
  }),
);

export const passengers = skypadi.table(
  "passengers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    label: text("label"),
    title: text("title"),
    firstName: text("first_name").notNull(),
    middleName: text("middle_name"),
    lastName: text("last_name").notNull(),
    dateOfBirth: date("date_of_birth"),
    gender: text("gender"),
    phoneNumber: text("phone_number"),
    email: text("email"),
    isDefault: boolean("is_default").notNull().default(false),
    ...timestamps,
  },
  (table) => ({
    userIdIdx: index("passengers_user_id_idx").on(table.userId),
  }),
);

export const flightSearches = skypadi.table(
  "flight_searches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    origin: text("origin").notNull(),
    destination: text("destination").notNull(),
    departureDate: date("departure_date").notNull(),
    returnDate: date("return_date"),
    adults: integer("adults").notNull().default(1),
    children: integer("children").notNull().default(0),
    infants: integer("infants").notNull().default(0),
    cabinClass: text("cabin_class"),
    currency: text("currency").notNull().default("NGN"),
    rawRequest: jsonb("raw_request").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    ...timestamps,
  },
  (table) => ({
    userIdIdx: index("flight_searches_user_id_idx").on(table.userId),
    routeIdx: index("flight_searches_route_idx").on(table.origin, table.destination, table.departureDate),
  }),
);

export const flightOptions = skypadi.table(
  "flight_options",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    flightSearchId: uuid("flight_search_id").notNull().references(() => flightSearches.id, { onDelete: "cascade" }),
    supplier: text("supplier").notNull(),
    supplierOptionId: text("supplier_option_id"),
    airlineCode: text("airline_code"),
    airlineName: text("airline_name"),
    flightNumber: text("flight_number"),
    origin: text("origin").notNull(),
    destination: text("destination").notNull(),
    departureAt: timestamp("departure_at", { withTimezone: true }).notNull(),
    arrivalAt: timestamp("arrival_at", { withTimezone: true }).notNull(),
    durationMinutes: integer("duration_minutes"),
    stops: integer("stops").notNull().default(0),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("NGN"),
    rank: integer("rank"),
    recommendationReason: text("recommendation_reason"),
    fareRules: jsonb("fare_rules").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    supplierPayload: jsonb("supplier_payload").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    ...timestamps,
  },
  (table) => ({
    flightSearchIdIdx: index("flight_options_flight_search_id_idx").on(table.flightSearchId),
    supplierOptionIdx: index("flight_options_supplier_option_idx").on(table.supplier, table.supplierOptionId),
  }),
);

export const bookings = skypadi.table(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    flightSearchId: uuid("flight_search_id").references(() => flightSearches.id, { onDelete: "set null" }),
    selectedFlightOptionId: uuid("selected_flight_option_id").references(() => flightOptions.id, { onDelete: "set null" }),
    status: bookingStatusEnum("status").notNull().default("draft"),
    supplier: text("supplier"),
    supplierBookingReference: text("supplier_booking_reference"),
    supplierHoldExpiresAt: timestamp("supplier_hold_expires_at", { withTimezone: true }),
    amount: numeric("amount", { precision: 12, scale: 2 }),
    currency: text("currency").notNull().default("NGN"),
    customerEmail: text("customer_email"),
    failureReason: text("failure_reason"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    ...timestamps,
  },
  (table) => ({
    userIdIdx: index("bookings_user_id_idx").on(table.userId),
    statusIdx: index("bookings_status_idx").on(table.status),
    supplierReferenceIdx: index("bookings_supplier_reference_idx").on(table.supplier, table.supplierBookingReference),
  }),
);

export const bookingPassengers = skypadi.table(
  "booking_passengers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
    passengerId: uuid("passenger_id").references(() => passengers.id, { onDelete: "set null" }),
    passengerType: text("passenger_type").notNull().default("adult"),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    ...timestamps,
  },
  (table) => ({
    bookingIdIdx: index("booking_passengers_booking_id_idx").on(table.bookingId),
  }),
);

export const paymentAttempts = skypadi.table(
  "payment_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
    method: text("method").notNull(),
    provider: text("provider"),
    providerReference: text("provider_reference"),
    status: paymentStatusEnum("status").notNull().default("pending"),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("NGN"),
    proofUrl: text("proof_url"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNotes: text("review_notes"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    ...timestamps,
  },
  (table) => ({
    bookingIdIdx: index("payment_attempts_booking_id_idx").on(table.bookingId),
    providerReferenceIdx: uniqueIndex("payment_attempts_provider_reference_idx").on(table.providerReference),
  }),
);

export const bookingEmailAliases = skypadi.table(
  "booking_email_aliases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    emailAddress: text("email_address").notNull(),
    localPart: text("local_part").notNull(),
    domain: text("domain").notNull(),
    status: bookingEmailAliasStatusEnum("status").notNull().default("active"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    ...timestamps,
  },
  (table) => ({
    emailAddressIdx: uniqueIndex("booking_email_aliases_email_address_idx").on(table.emailAddress),
    bookingIdIdx: index("booking_email_aliases_booking_id_idx").on(table.bookingId),
  }),
);

export const inboundEmails = skypadi.table(
  "inbound_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
    bookingEmailAliasId: uuid("booking_email_alias_id").references(() => bookingEmailAliases.id, { onDelete: "set null" }),
    resendEmailId: text("resend_email_id").notNull(),
    messageId: text("message_id"),
    fromEmail: text("from_email").notNull(),
    toEmails: text("to_emails").array().notNull().default(sql`'{}'::text[]`),
    subject: text("subject").notNull(),
    textBody: text("text_body"),
    htmlBody: text("html_body"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    classification: inboundEmailClassificationEnum("classification").notNull().default("other"),
    extractedOtp: text("extracted_otp"),
    otpConsumedAt: timestamp("otp_consumed_at", { withTimezone: true }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    resendEmailIdIdx: uniqueIndex("inbound_emails_resend_email_id_idx").on(table.resendEmailId),
    aliasClassificationIdx: index("inbound_emails_alias_classification_idx").on(
      table.bookingEmailAliasId,
      table.classification,
      table.receivedAt,
    ),
  }),
);

export const supplierEvents = skypadi.table(
  "supplier_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "cascade" }),
    inboundEmailId: uuid("inbound_email_id").references(() => inboundEmails.id, { onDelete: "set null" }),
    supplier: text("supplier").notNull(),
    eventType: text("event_type").notNull(),
    supplierReference: text("supplier_reference"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    bookingIdIdx: index("supplier_events_booking_id_idx").on(table.bookingId),
    eventTypeIdx: index("supplier_events_event_type_idx").on(table.eventType),
  }),
);

export const auditEvents = skypadi.table(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "cascade" }),
    paymentAttemptId: uuid("payment_attempt_id").references(() => paymentAttempts.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    actorType: text("actor_type").notNull().default("system"),
    actorId: text("actor_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    bookingIdIdx: index("audit_events_booking_id_idx").on(table.bookingId),
    eventTypeIdx: index("audit_events_event_type_idx").on(table.eventType),
  }),
);
