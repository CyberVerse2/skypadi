import { env } from "../config.js";
import { AgentMailClient, AgentMail } from "agentmail";

const API_BASE = "https://api.agentmail.to/v0";
const realtimeClient = env.AGENTMAIL_API_KEY ? new AgentMailClient({ apiKey: env.AGENTMAIL_API_KEY }) : undefined;

export type AgentMailMessage = {
  message_id: string;
  thread_id?: string;
  from: string;
  to: string[];
  subject: string;
  /** Truncated body returned by list endpoint (~200 chars). */
  preview?: string;
  /** Full plain-text body (only in get-single response). */
  text?: string;
  /** Full HTML body (only in get-single response). */
  html?: string;
  extracted_text?: string;
  timestamp: string;
  labels?: string[];
};

export type Inbox = { id: string; email: string };

export function isConfigured(): boolean {
  return Boolean(env.AGENTMAIL_API_KEY);
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!env.AGENTMAIL_API_KEY) throw new Error("AGENTMAIL_API_KEY not set");
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.AGENTMAIL_API_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`AgentMail ${init.method ?? "GET"} ${path} → ${res.status}: ${body.slice(0, 300)}`);
  return body ? (JSON.parse(body) as T) : (undefined as T);
}

export async function createInbox(displayName = "SkyPadi Booking"): Promise<Inbox> {
  const res = await api<{ inbox_id: string; email: string }>("/inboxes", {
    method: "POST",
    body: JSON.stringify({ display_name: displayName })
  });
  return { id: res.inbox_id, email: res.email };
}

export async function listMessages(inboxId: string, opts: { after?: string; limit?: number } = {}): Promise<AgentMailMessage[]> {
  const params = new URLSearchParams();
  if (opts.after) params.set("after", opts.after);
  params.set("limit", String(opts.limit ?? 50));
  const res = await api<{ messages?: AgentMailMessage[] }>(`/inboxes/${encodeURIComponent(inboxId)}/messages?${params}`);
  return res.messages ?? [];
}

export async function waitForMessage(
  inboxId: string,
  opts: {
    matcher?: (m: AgentMailMessage) => boolean;
    timeoutMs?: number;
    pollMs?: number;
    sinceIso?: string;
  } = {}
): Promise<AgentMailMessage | undefined> {
  const matcher = opts.matcher ?? (() => true);
  const pollMs = opts.pollMs ?? 5_000;
  const deadline = Date.now() + (opts.timeoutMs ?? 180_000);
  console.log(`[agentmail] Waiting for message in ${inboxId} (timeout=${opts.timeoutMs ?? 180_000}ms, since=${opts.sinceIso ?? "none"})`);

  const websocketHit = await waitForMessageViaWebsocket(inboxId, opts, matcher).catch(() => undefined);
  if (websocketHit) return websocketHit;

  while (Date.now() < deadline) {
    const messages = await listMessages(inboxId, { after: opts.sinceIso });
    if (messages.length > 0) {
      console.log(`[agentmail] Poll fetched ${messages.length} message(s) for ${inboxId}`);
    }
    for (const message of messages) {
      if (matcher(message)) {
        console.log(`[agentmail] Direct match on listed message ${describeMessage(message)}`);
        if (message.text || message.html || message.extracted_text) return message;
        return getMessage(inboxId, message.message_id)
          .then((full) => {
            console.log(`[agentmail] Hydrated direct-match message ${describeMessage(full)}`);
            return full;
          })
          .catch((error) => {
            console.log(`[agentmail] Failed to hydrate direct-match message ${message.message_id}: ${String(error)}`);
            return message;
          });
      }

      const candidateSignal = `${message.from} ${message.subject} ${message.preview ?? ""}`;
      if (/wakanow|verif|code|otp/i.test(candidateSignal)) {
        console.log(`[agentmail] Candidate message ${describeMessage(message)}`);
        const fullMessage = await getMessage(inboxId, message.message_id).catch(() => undefined);
        if (fullMessage) {
          console.log(`[agentmail] Hydrated candidate ${describeMessage(fullMessage)} otp=${extractOtpCode(messageBody(fullMessage)) ?? "none"}`);
        }
        if (fullMessage && matcher(fullMessage)) return fullMessage;
      }
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  console.log(`[agentmail] Timed out waiting for message in ${inboxId}`);
  return undefined;
}

async function waitForMessageViaWebsocket(
  inboxId: string,
  opts: {
    timeoutMs?: number;
    sinceIso?: string;
  },
  matcher: (m: AgentMailMessage) => boolean
): Promise<AgentMailMessage | undefined> {
  if (!realtimeClient) return undefined;

  const timeoutMs = opts.timeoutMs ?? 180_000;
  const sinceTime = opts.sinceIso ? new Date(opts.sinceIso).getTime() : undefined;

  return new Promise<AgentMailMessage | undefined>(async (resolve) => {
    const socket = await realtimeClient.websockets.connect().catch(() => undefined);
    if (!socket) return resolve(undefined);
    let settled = false;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
    };

    const finish = (message: AgentMailMessage | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      resolve(message);
    };

    const timer = setTimeout(() => {
      finish(undefined);
    }, timeoutMs);

    socket.on("open", () => {
      console.log(`[agentmail] Websocket connected for inbox ${inboxId}`);
      socket.sendSubscribe({
        type: "subscribe",
        inboxIds: [inboxId],
        eventTypes: ["message.received"]
      });
    });

    socket.on("message", (event) => {
      if (event.type !== "event" || event.eventType !== "message.received") return;
      const message = mapRealtimeMessage(event.message);
      console.log(`[agentmail] Websocket received ${describeMessage(message)} otp=${extractOtpCode(messageBody(message)) ?? "none"}`);
      const messageTime = Date.parse(message.timestamp);
      if (Number.isFinite(sinceTime) && Number.isFinite(messageTime) && messageTime < (sinceTime as number)) return;
      if (!matcher(message)) return;
      finish(message);
    });

    socket.on("error", () => {
      console.log(`[agentmail] Websocket error for inbox ${inboxId}`);
      finish(undefined);
    });

    socket.on("close", () => {
      if (settled) return;
      console.log(`[agentmail] Websocket closed for inbox ${inboxId}`);
      settled = true;
      clearTimeout(timer);
      resolve(undefined);
    });
  });
}

function mapRealtimeMessage(message: AgentMail.Message): AgentMailMessage {
  return {
    message_id: message.messageId,
    thread_id: message.threadId,
    from: message.from,
    to: message.to,
    subject: message.subject ?? "",
    preview: message.preview,
    text: message.text,
    html: message.html,
    extracted_text: message.extractedText,
    timestamp: message.timestamp.toISOString(),
    labels: message.labels
  };
}

function describeMessage(message: AgentMailMessage): string {
  return `${message.message_id} from="${message.from}" subject="${message.subject ?? ""}" timestamp=${message.timestamp} preview="${(message.preview ?? "").slice(0, 120)}"`;
}

export function extractOtpCode(text: string): string | undefined {
  const labeledMatch = text.match(/verification\s*code[^0-9]{0,40}(\d{4,8})/i);
  if (labeledMatch?.[1]) return labeledMatch[1];

  const otpMatch = text.match(/\botp[^0-9]{0,40}(\d{4,8})/i);
  if (otpMatch?.[1]) return otpMatch[1];

  return text.match(/\b\d{4,8}\b/)?.[0];
}

/** Extract readable text from a message. List responses only have `preview`; get-single has full text/html. */
export function messageBody(m: AgentMailMessage): string {
  if (m.text) return m.text;
  if (m.extracted_text) return m.extracted_text;
  if (m.html) return m.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (m.preview) return m.preview;
  return "";
}

export async function getMessage(inboxId: string, messageId: string): Promise<AgentMailMessage> {
  return api<AgentMailMessage>(`/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}`);
}

export type SendMessageOpts = {
  to: string[];
  subject: string;
  text?: string;
  html?: string;
  cc?: string[];
  bcc?: string[];
  reply_to?: string;
};

export async function sendMessage(inboxId: string, opts: SendMessageOpts): Promise<{ message_id: string; thread_id: string }> {
  return api<{ message_id: string; thread_id: string }>(`/inboxes/${encodeURIComponent(inboxId)}/messages/send`, {
    method: "POST",
    body: JSON.stringify(opts)
  });
}

export async function deleteInbox(inboxId: string): Promise<void> {
  await api<void>(`/inboxes/${encodeURIComponent(inboxId)}`, { method: "DELETE" });
}
