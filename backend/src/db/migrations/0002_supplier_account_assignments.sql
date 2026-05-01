CREATE TABLE "skypadi_whatsapp"."supplier_account_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"supplier" text NOT NULL,
	"account_email" text NOT NULL,
	"pool_index" integer NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skypadi_whatsapp"."supplier_account_assignments" ADD CONSTRAINT "supplier_account_assignments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "skypadi_whatsapp"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_account_assignments_booking_supplier_idx" ON "skypadi_whatsapp"."supplier_account_assignments" USING btree ("booking_id","supplier");--> statement-breakpoint
CREATE INDEX "supplier_account_assignments_supplier_assigned_at_idx" ON "skypadi_whatsapp"."supplier_account_assignments" USING btree ("supplier","assigned_at");--> statement-breakpoint
CREATE INDEX "supplier_account_assignments_account_email_idx" ON "skypadi_whatsapp"."supplier_account_assignments" USING btree ("account_email");