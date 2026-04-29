import type { InboundEmailClassification, InboundEmailPublicClassification } from "./inbound-email.types.js";

export type InboundEmailContent = {
  subject: string;
  text?: string;
  html?: string;
  from: string;
};

export type InternalInboundEmailClassification = InboundEmailPublicClassification & {
  otp?: string;
};

export function classifyInboundEmailContent(input: InboundEmailContent): InternalInboundEmailClassification {
  const body = messageBody(input);
  const haystack = `${input.from} ${input.subject} ${body.slice(0, 1000)}`;
  const otp = extractOtpCode(body);

  if (otp && /wakanow|verif|code|otp/i.test(haystack)) {
    return { classification: "verification_code", hasCode: true, otp };
  }

  if (/schedule change|rescheduled|cancelled|canceled|delay|changed/i.test(haystack)) {
    return { classification: "supplier_change", hasCode: false };
  }

  if (/receipt|payment|paid|transfer|deposit/i.test(haystack)) {
    return { classification: "payment_or_receipt", hasCode: false };
  }

  if (/ticket|e-ticket|booking|itinerary|reservation|confirmed|confirmation/i.test(haystack)) {
    return { classification: "booking_confirmation", hasCode: false };
  }

  return { classification: "other", hasCode: false };
}

export function publicClassification(input: InternalInboundEmailClassification): InboundEmailPublicClassification {
  return { classification: input.classification, hasCode: input.hasCode };
}

export function supplierEventTypeForClassification(classification: InboundEmailClassification): string | undefined {
  if (classification === "verification_code" || classification === "booking_confirmation") {
    return `supplier_email.${classification}`;
  }

  return undefined;
}

function extractOtpCode(text: string): string | undefined {
  const labeledMatch = text.match(/verification\s*code[^0-9]{0,40}(\d{4,8})/i);
  if (labeledMatch?.[1]) return labeledMatch[1];

  const otpMatch = text.match(/\botp[^0-9]{0,40}(\d{4,8})/i);
  if (otpMatch?.[1]) return otpMatch[1];

  return text.match(/\b\d{4,8}\b/)?.[0];
}

function messageBody(input: InboundEmailContent): string {
  if (input.text) return input.text;
  if (input.html) return input.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return "";
}
