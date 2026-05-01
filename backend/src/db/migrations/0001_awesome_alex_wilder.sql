CREATE TYPE "skypadi_whatsapp"."supplier_booking_job_status" AS ENUM('queued', 'running', 'succeeded', 'retryable_failed', 'terminal_failed');--> statement-breakpoint
CREATE TABLE "skypadi_whatsapp"."supplier_booking_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"graphile_job_key" text NOT NULL,
	"status" "skypadi_whatsapp"."supplier_booking_job_status" DEFAULT 'queued' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skypadi_whatsapp"."supplier_booking_jobs" ADD CONSTRAINT "supplier_booking_jobs_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "skypadi_whatsapp"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_booking_jobs_booking_id_idx" ON "skypadi_whatsapp"."supplier_booking_jobs" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_booking_jobs_graphile_job_key_idx" ON "skypadi_whatsapp"."supplier_booking_jobs" USING btree ("graphile_job_key");--> statement-breakpoint
CREATE INDEX "supplier_booking_jobs_status_idx" ON "skypadi_whatsapp"."supplier_booking_jobs" USING btree ("status");
