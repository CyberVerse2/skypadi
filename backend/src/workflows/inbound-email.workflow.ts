import {
  classifyInboundEmailContent,
  publicClassification,
  supplierEventTypeForClassification,
  type InboundEmailContent,
} from "../domain/inbound-email/inbound-email.service.js";
import type { InboundEmailRepository } from "../domain/inbound-email/inbound-email.repository.js";
import type { InboundEmailPublicClassification } from "../domain/inbound-email/inbound-email.types.js";
import { makeOk, type WorkflowResult } from "./workflow-result.js";

export type HandleInboundEmailInput = InboundEmailContent & {
  resendEmailId: string;
  messageId?: string;
  to: string | string[];
  receivedAt: Date;
  repository?: InboundEmailRepository;
  raw?: Record<string, unknown>;
};

export function classifyInboundEmail(input: InboundEmailContent): InboundEmailPublicClassification {
  return publicClassification(classifyInboundEmailContent(input));
}

export function handleInboundEmailForClassificationOnly(input: InboundEmailContent): WorkflowResult<InboundEmailPublicClassification> {
  return makeOk(classifyInboundEmail(input));
}

export async function handleInboundEmail(
  input: HandleInboundEmailInput
): Promise<WorkflowResult<InboundEmailPublicClassification>> {
  if (!input.repository) {
    return { kind: "temporary_failure", reason: "inbound email repository dependency is required" };
  }

  const recipients = normalizeRecipients(input.to);
  const alias = await findFirstActiveAlias(recipients, input.repository);
  if (!alias) {
    return { kind: "needs_manual_review", reason: "inbound email has no booking alias recipient" };
  }

  const internalClassification = classifyInboundEmailContent(input);
  const saved = await input.repository.saveInboundEmail({
    bookingId: alias.bookingId,
    bookingEmailAliasId: alias.id,
    resendEmailId: input.resendEmailId,
    messageId: input.messageId,
    from: input.from,
    to: recipients,
    subject: input.subject,
    text: input.text,
    html: input.html,
    receivedAt: input.receivedAt,
    classification: internalClassification.classification,
    extractedOtp: internalClassification.otp,
    raw: input.raw,
  });

  const eventType = supplierEventTypeForClassification(internalClassification.classification);
  if (eventType && saved.wasCreated) {
    await input.repository.recordSupplierEvent({
      bookingId: alias.bookingId,
      inboundEmailId: saved.id,
      supplier: "wakanow",
      eventType,
      payload: {
        classification: internalClassification.classification,
        hasCode: internalClassification.hasCode,
        from: input.from,
        subject: input.subject,
      },
      observedAt: input.receivedAt,
    });
  }

  return makeOk(publicClassification(internalClassification));
}

export async function consumeInboundEmailOtp(input: {
  inboundEmailId: string;
  repository: Pick<InboundEmailRepository, "consumeOtp">;
  consumedAt?: Date;
}): Promise<void> {
  await input.repository.consumeOtp({
    inboundEmailId: input.inboundEmailId,
    consumedAt: input.consumedAt ?? new Date(),
  });
}

export async function waitForInboundEmailOtp(input: {
  bookingId: string;
  repository: Pick<InboundEmailRepository, "claimNextUnconsumedOtp" | "consumeOtp">;
  timeoutMs?: number;
  pollMs?: number;
  claimTimeoutMs?: number;
  now?: () => Date;
}): Promise<{ code: string; consume: () => Promise<void> } | undefined> {
  const timeoutMs = input.timeoutMs ?? 90_000;
  const pollMs = input.pollMs ?? 2_000;
  const claimTimeoutMs = input.claimTimeoutMs ?? 5 * 60_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const claimedAt = input.now?.() ?? new Date();
    const otp = await input.repository.claimNextUnconsumedOtp({
      bookingId: input.bookingId,
      claimedAt,
      claimExpiresBefore: new Date(claimedAt.getTime() - claimTimeoutMs),
    });
    if (otp) {
      return {
        code: otp.otp,
        consume: () => input.repository.consumeOtp({
          inboundEmailId: otp.inboundEmailId,
          consumedAt: input.now?.() ?? new Date(),
        }),
      };
    }

    await sleep(pollMs);
  }

  return undefined;
}

function normalizeRecipients(to: string | string[]): string[] {
  const values = Array.isArray(to) ? to : [to];
  return values.map(normalizeAddress);
}

function normalizeAddress(address: string): string {
  const match = address.match(/<([^>]+)>/);
  return (match?.[1] ?? address).trim().toLowerCase();
}

async function findFirstActiveAlias(recipients: string[], repository: InboundEmailRepository) {
  for (const recipient of recipients) {
    if (!recipient.includes("@")) continue;
    const alias = await repository.findActiveAliasByEmail(recipient);
    if (alias) return alias;
  }

  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
