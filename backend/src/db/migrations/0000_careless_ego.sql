CREATE SCHEMA IF NOT EXISTS "skypadi_whatsapp";--> statement-breakpoint
CREATE TYPE "skypadi_whatsapp"."booking_email_alias_status" AS ENUM('active', 'used', 'expired', 'disabled');--> statement-breakpoint
CREATE TYPE "skypadi_whatsapp"."booking_status" AS ENUM('draft', 'priced', 'passenger_details_collected', 'payment_pending', 'payment_confirmed', 'supplier_hold_pending', 'supplier_hold_created', 'awaiting_payment_for_hold', 'supplier_booking_pending', 'supplier_verification_required', 'issued', 'hold_expired', 'failed', 'cancelled', 'manual_review_required');--> statement-breakpoint
CREATE TYPE "skypadi_whatsapp"."conversation_message_direction" AS ENUM('inbound', 'outbound', 'system');--> statement-breakpoint
CREATE TYPE "skypadi_whatsapp"."conversation_status" AS ENUM('collecting_trip_details', 'presenting_flight_options', 'collecting_passenger_details', 'awaiting_payment_choice', 'awaiting_payment_confirmation', 'issuing_supplier_booking', 'awaiting_supplier_verification', 'ticket_issued', 'manual_review_required');--> statement-breakpoint
CREATE TYPE "skypadi_whatsapp"."inbound_email_classification" AS ENUM('verification_code', 'booking_confirmation', 'payment_or_receipt', 'supplier_change', 'other');--> statement-breakpoint
CREATE TYPE "skypadi_whatsapp"."payment_status" AS ENUM('pending', 'proof_uploaded', 'confirmed', 'failed', 'expired', 'refunded', 'manual_review_required');--> statement-breakpoint
CREATE TABLE "skypadi_whatsapp"."audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"booking_id" uuid,
	"payment_attempt_id" uuid,
	"event_type" text NOT NULL,
	"actor_type" text DEFAULT 'system' NOT NULL,
	"actor_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skypadi_whatsapp"."booking_email_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid,
	"user_id" uuid,
	"email_address" text NOT NULL,
	"local_part" text NOT NULL,
	"domain" text NOT NULL,
	"status" "skypadi_whatsapp"."booking_email_alias_status" DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skypadi_whatsapp"."booking_passengers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"passenger_id" uuid,
	"passenger_type" text DEFAULT 'adult' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skypadi_whatsapp"."bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid,
	"flight_search_id" uuid,
	"selected_flight_option_id" uuid,
	"status" "skypadi_whatsapp"."booking_status" DEFAULT 'draft' NOT NULL,
	"supplier" text,
	"supplier_booking_reference" text,
	"supplier_hold_expires_at" timestamp with time zone,
	"amount" numeric(12, 2),
	"currency" text DEFAULT 'NGN' NOT NULL,
	"customer_email" text,
	"failure_reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skypadi_whatsapp"."conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"direction" "skypadi_whatsapp"."conversation_message_direction" NOT NULL,
	"provider_message_id" text,
	"text_body" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sent_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skypadi_whatsapp"."conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"whatsapp_contact_id" uuid,
	"status" "skypadi_whatsapp"."conversation_status" DEFAULT 'collecting_trip_details' NOT NULL,
	"last_message_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skypadi_whatsapp"."flight_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flight_search_id" uuid NOT NULL,
	"supplier" text NOT NULL,
	"supplier_option_id" text,
	"airline_code" text,
	"airline_name" text,
	"flight_number" text,
	"origin" text NOT NULL,
	"destination" text NOT NULL,
	"departure_at" timestamp with time zone NOT NULL,
	"arrival_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer,
	"stops" integer DEFAULT 0 NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"rank" integer,
	"recommendation_reason" text,
	"fare_rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"supplier_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skypadi_whatsapp"."flight_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid,
	"origin" text NOT NULL,
	"destination" text NOT NULL,
	"departure_date" date NOT NULL,
	"return_date" date,
	"adults" integer DEFAULT 1 NOT NULL,
	"children" integer DEFAULT 0 NOT NULL,
	"infants" integer DEFAULT 0 NOT NULL,
	"cabin_class" text,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"raw_request" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skypadi_whatsapp"."inbound_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid,
	"booking_email_alias_id" uuid,
	"resend_email_id" text NOT NULL,
	"message_id" text,
	"from_email" text NOT NULL,
	"to_emails" text[] DEFAULT '{}'::text[] NOT NULL,
	"subject" text NOT NULL,
	"text_body" text,
	"html_body" text,
	"received_at" timestamp with time zone NOT NULL,
	"classification" "skypadi_whatsapp"."inbound_email_classification" DEFAULT 'other' NOT NULL,
	"extracted_otp" text,
	"otp_consumed_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skypadi_whatsapp"."passengers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text,
	"title" text,
	"first_name" text NOT NULL,
	"middle_name" text,
	"last_name" text NOT NULL,
	"date_of_birth" date,
	"gender" text,
	"phone_number" text,
	"email" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skypadi_whatsapp"."payment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"method" text NOT NULL,
	"provider" text,
	"provider_reference" text,
	"status" "skypadi_whatsapp"."payment_status" DEFAULT 'pending' NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"proof_url" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"review_notes" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skypadi_whatsapp"."supplier_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid,
	"inbound_email_id" uuid,
	"supplier" text NOT NULL,
	"event_type" text NOT NULL,
	"supplier_reference" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skypadi_whatsapp"."user_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"home_airport_code" text,
	"preferred_currency" text DEFAULT 'NGN' NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skypadi_whatsapp"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text,
	"locale" text,
	"timezone" text,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skypadi_whatsapp"."whatsapp_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"phone_number" text NOT NULL,
	"profile_name" text,
	"wa_id" text,
	"is_primary" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skypadi_whatsapp"."audit_events" ADD CONSTRAINT "audit_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "skypadi_whatsapp"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skypadi_whatsapp"."audit_events" ADD CONSTRAINT "audit_events_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "skypadi_whatsapp"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skypadi_whatsapp"."audit_events" ADD CONSTRAINT "audit_events_payment_attempt_id_payment_attempts_id_fk" FOREIGN KEY ("payment_attempt_id") REFERENCES "skypadi_whatsapp"."payment_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skypadi_whatsapp"."booking_email_aliases" ADD CONSTRAINT "booking_email_aliases_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "skypadi_whatsapp"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skypadi_whatsapp"."booking_email_aliases" ADD CONSTRAINT "booking_email_aliases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "skypadi_whatsapp"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skypadi_whatsapp"."booking_passengers" ADD CONSTRAINT "booking_passengers_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "skypadi_whatsapp"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skypadi_whatsapp"."booking_passengers" ADD CONSTRAINT "booking_passengers_passenger_id_passengers_id_fk" FOREIGN KEY ("passenger_id") REFERENCES "skypadi_whatsapp"."passengers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skypadi_whatsapp"."bookings" ADD CONSTRAINT "bookings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "skypadi_whatsapp"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skypadi_whatsapp"."bookings" ADD CONSTRAINT "bookings_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "skypadi_whatsapp"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skypadi_whatsapp"."bookings" ADD CONSTRAINT "bookings_flight_search_id_flight_searches_id_fk" FOREIGN KEY ("flight_search_id") REFERENCES "skypadi_whatsapp"."flight_searches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skypadi_whatsapp"."bookings" ADD CONSTRAINT "bookings_selected_flight_option_id_flight_options_id_fk" FOREIGN KEY ("selected_flight_option_id") REFERENCES "skypadi_whatsapp"."flight_options"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skypadi_whatsapp"."conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "skypadi_whatsapp"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skypadi_whatsapp"."conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "skypadi_whatsapp"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skypadi_whatsapp"."conversations" ADD CONSTRAINT "conversations_whatsapp_contact_id_whatsapp_contacts_id_fk" FOREIGN KEY ("whatsapp_contact_id") REFERENCES "skypadi_whatsapp"."whatsapp_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skypadi_whatsapp"."flight_options" ADD CONSTRAINT "flight_options_flight_search_id_flight_searches_id_fk" FOREIGN KEY ("flight_search_id") REFERENCES "skypadi_whatsapp"."flight_searches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skypadi_whatsapp"."flight_searches" ADD CONSTRAINT "flight_searches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "skypadi_whatsapp"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skypadi_whatsapp"."flight_searches" ADD CONSTRAINT "flight_searches_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "skypadi_whatsapp"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skypadi_whatsapp"."inbound_emails" ADD CONSTRAINT "inbound_emails_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "skypadi_whatsapp"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skypadi_whatsapp"."inbound_emails" ADD CONSTRAINT "inbound_emails_booking_email_alias_id_booking_email_aliases_id_fk" FOREIGN KEY ("booking_email_alias_id") REFERENCES "skypadi_whatsapp"."booking_email_aliases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skypadi_whatsapp"."passengers" ADD CONSTRAINT "passengers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "skypadi_whatsapp"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skypadi_whatsapp"."payment_attempts" ADD CONSTRAINT "payment_attempts_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "skypadi_whatsapp"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skypadi_whatsapp"."supplier_events" ADD CONSTRAINT "supplier_events_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "skypadi_whatsapp"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skypadi_whatsapp"."supplier_events" ADD CONSTRAINT "supplier_events_inbound_email_id_inbound_emails_id_fk" FOREIGN KEY ("inbound_email_id") REFERENCES "skypadi_whatsapp"."inbound_emails"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skypadi_whatsapp"."user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "skypadi_whatsapp"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skypadi_whatsapp"."whatsapp_contacts" ADD CONSTRAINT "whatsapp_contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "skypadi_whatsapp"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_booking_id_idx" ON "skypadi_whatsapp"."audit_events" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "audit_events_event_type_idx" ON "skypadi_whatsapp"."audit_events" USING btree ("event_type");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_email_aliases_email_address_idx" ON "skypadi_whatsapp"."booking_email_aliases" USING btree ("email_address");--> statement-breakpoint
CREATE INDEX "booking_email_aliases_booking_id_idx" ON "skypadi_whatsapp"."booking_email_aliases" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "booking_passengers_booking_id_idx" ON "skypadi_whatsapp"."booking_passengers" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "bookings_user_id_idx" ON "skypadi_whatsapp"."bookings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bookings_status_idx" ON "skypadi_whatsapp"."bookings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bookings_supplier_reference_idx" ON "skypadi_whatsapp"."bookings" USING btree ("supplier","supplier_booking_reference");--> statement-breakpoint
CREATE INDEX "conversation_messages_conversation_id_idx" ON "skypadi_whatsapp"."conversation_messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_messages_provider_message_id_idx" ON "skypadi_whatsapp"."conversation_messages" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX "conversations_user_id_idx" ON "skypadi_whatsapp"."conversations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "conversations_status_idx" ON "skypadi_whatsapp"."conversations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "flight_options_flight_search_id_idx" ON "skypadi_whatsapp"."flight_options" USING btree ("flight_search_id");--> statement-breakpoint
CREATE INDEX "flight_options_supplier_option_idx" ON "skypadi_whatsapp"."flight_options" USING btree ("supplier","supplier_option_id");--> statement-breakpoint
CREATE INDEX "flight_searches_user_id_idx" ON "skypadi_whatsapp"."flight_searches" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "flight_searches_route_idx" ON "skypadi_whatsapp"."flight_searches" USING btree ("origin","destination","departure_date");--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_emails_resend_email_id_idx" ON "skypadi_whatsapp"."inbound_emails" USING btree ("resend_email_id");--> statement-breakpoint
CREATE INDEX "inbound_emails_alias_classification_idx" ON "skypadi_whatsapp"."inbound_emails" USING btree ("booking_email_alias_id","classification","received_at");--> statement-breakpoint
CREATE INDEX "passengers_user_id_idx" ON "skypadi_whatsapp"."passengers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payment_attempts_booking_id_idx" ON "skypadi_whatsapp"."payment_attempts" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_provider_reference_idx" ON "skypadi_whatsapp"."payment_attempts" USING btree ("provider_reference");--> statement-breakpoint
CREATE INDEX "supplier_events_booking_id_idx" ON "skypadi_whatsapp"."supplier_events" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "supplier_events_event_type_idx" ON "skypadi_whatsapp"."supplier_events" USING btree ("event_type");--> statement-breakpoint
CREATE UNIQUE INDEX "user_preferences_user_id_idx" ON "skypadi_whatsapp"."user_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_contacts_phone_number_idx" ON "skypadi_whatsapp"."whatsapp_contacts" USING btree ("phone_number");--> statement-breakpoint
CREATE INDEX "whatsapp_contacts_user_id_idx" ON "skypadi_whatsapp"."whatsapp_contacts" USING btree ("user_id");
