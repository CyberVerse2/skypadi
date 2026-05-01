import type { Task } from "graphile-worker";
import { sql } from "drizzle-orm";

import { createWhatsAppCloudClient, type WhatsAppClient } from "../../channels/whatsapp/whatsapp.client";
import { db } from "../../db/client";
import type { BookingStatus } from "../../domain/booking/booking.types";
import { createDrizzleConversationRepository } from "../../domain/conversation/conversation.repository";
import { createWakanowBrowserHoldClient, type WakanowHoldClient } from "../../integrations/wakanow/wakanow.booking";
import {
  createDrizzleSupplierBookingRepository,
  handleSupplierHoldResult,
  recordSupplierHoldDecision,
  type SupplierBookingRepository,
} from "../../workflows/supplier-booking.workflow";
import { findSupplierBookingRecipient, notifySupplierDecision } from "../booking-job-notifier";
import { createDrizzleSupplierBookingJobRepository } from "../booking-job.repository";
import type { SupplierBookingJobPayload, SupplierBookingJobRepository } from "../booking-job.types";
import { shouldSkipSupplierBookingForStatus } from "./supplier-booking-status";

type SupplierBookingTaskDependencies = {
  jobRepository: SupplierBookingJobRepository;
  supplierClient: Pick<WakanowHoldClient, "createHoldForBooking">;
  supplierRepository: SupplierBookingRepository;
  findBookingStatus: (bookingId: string) => Promise<BookingStatus | undefined>;
  notifyRecordedDecision: (input: {
    bookingId: string;
    decision: Awaited<ReturnType<typeof recordSupplierHoldDecision>>;
  }) => Promise<void>;
};

export function createSupplierBookingTask(dependencies: SupplierBookingTaskDependencies): Task {
  return async (payload) => {
    assertSupplierBookingPayload(payload);

    await dependencies.jobRepository.markRunning({ bookingId: payload.bookingId, startedAt: new Date() });

    try {
      const bookingStatus = await dependencies.findBookingStatus(payload.bookingId);
      if (shouldSkipSupplierBookingForStatus(bookingStatus)) {
        await dependencies.jobRepository.markSucceeded({ bookingId: payload.bookingId, finishedAt: new Date() });
        return;
      }

      const supplierResult = await dependencies.supplierClient.createHoldForBooking({ bookingId: payload.bookingId });
      const decision = handleSupplierHoldResult({ bookingId: payload.bookingId, result: supplierResult });

      const recordedDecision = await recordSupplierHoldDecision({
        decision,
        repository: dependencies.supplierRepository,
        observedAt: new Date(),
      });
      try {
        await dependencies.notifyRecordedDecision({ bookingId: payload.bookingId, decision: recordedDecision });
      } catch (notificationError) {
        console.warn("[supplier-booking] Supplier decision was recorded but WhatsApp notification failed", {
          bookingId: payload.bookingId,
          errorMessage: notificationError instanceof Error ? notificationError.message : "Unknown notification failure",
        });
      }
      await dependencies.jobRepository.markSucceeded({ bookingId: payload.bookingId, finishedAt: new Date() });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Supplier booking job failed";
      await dependencies.jobRepository.markFailed({
        bookingId: payload.bookingId,
        failedAt: new Date(),
        errorMessage: message,
        retryable: isRetryableSupplierBookingError(message),
      });
      throw error;
    }
  };
}

export const supplierBookingTask: Task = createSupplierBookingTask({
  jobRepository: createDrizzleSupplierBookingJobRepository(db),
  supplierClient: createWakanowBrowserHoldClient({ db }),
  supplierRepository: createDrizzleSupplierBookingRepository(db),
  findBookingStatus,
  notifyRecordedDecision: notifyRecordedSupplierDecision,
});

function assertSupplierBookingPayload(payload: unknown): asserts payload is SupplierBookingJobPayload {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid supplier booking payload");
  }

  const value = payload as Record<string, unknown>;
  if (typeof value.bookingId !== "string" || value.bookingId.length === 0) {
    throw new Error("Invalid supplier booking payload bookingId");
  }
}

function isRetryableSupplierBookingError(message: string): boolean {
  return /timeout|network|browser|navigation|temporar/i.test(message);
}

async function findBookingStatus(bookingId: string): Promise<BookingStatus | undefined> {
  const result = await db.execute(sql`
    select status
    from skypadi_whatsapp.bookings
    where id = ${bookingId}
    limit 1
  `);
  const row = result.rows[0] as { status: BookingStatus } | undefined;
  return row?.status;
}

async function notifyRecordedSupplierDecision(input: {
  bookingId: string;
  decision: Awaited<ReturnType<typeof recordSupplierHoldDecision>>;
}): Promise<void> {
  const recipient = await findSupplierBookingRecipient({ db, bookingId: input.bookingId });
  if (!recipient) {
    console.warn("[supplier-booking] WhatsApp recipient not found", { bookingId: input.bookingId });
    return;
  }

  const whatsappClient = configuredWhatsAppClientFromEnv();
  if (!whatsappClient) {
    console.warn("[supplier-booking] WhatsApp credentials missing; skipped supplier decision notification", {
      bookingId: input.bookingId,
    });
    return;
  }

  const result = await notifySupplierDecision({
    decision: input.decision,
    recipient,
    whatsappClient,
    messageRepository: createDrizzleConversationRepository(db),
  });
  if (!result.ok) {
    console.warn("[supplier-booking] WhatsApp supplier decision notification failed", {
      bookingId: input.bookingId,
      errorMessage: result.errorMessage,
    });
  }
}

export function configuredWhatsAppClientFromEnv(
  environment: Partial<Pick<NodeJS.ProcessEnv, "WHATSAPP_ACCESS_TOKEN" | "WHATSAPP_PHONE_NUMBER_ID">> = process.env
): WhatsAppClient | undefined {
  if (!environment.WHATSAPP_ACCESS_TOKEN || !environment.WHATSAPP_PHONE_NUMBER_ID) return undefined;

  return createWhatsAppCloudClient({
    accessToken: environment.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: environment.WHATSAPP_PHONE_NUMBER_ID,
  });
}
