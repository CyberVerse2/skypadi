import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

type TraceEvent = {
  type?: string;
  callId?: string;
  class?: string;
  method?: string;
  startTime?: number;
  endTime?: number;
  time?: number;
  params?: Record<string, unknown>;
  error?: {
    name?: string;
    message?: string;
    stack?: string;
  };
  result?: {
    value?: unknown;
  };
  message?: string;
  sha1?: string;
  timestamp?: number;
};

type StackFile = string;
type StackFrame = [number, number, number, string];
type StacksPayload = {
  files: StackFile[];
  stacks: Array<[number, StackFrame[]]>;
};

type FailureSummary = {
  callId: string;
  className: string;
  method: string;
  message: string;
  source?: string;
};

function readZipEntry(zipPath: string, entry: string): string {
  return execFileSync("unzip", ["-p", zipPath, entry], {
    encoding: "utf8",
    maxBuffer: 25 * 1024 * 1024
  });
}

function readZipBinaryEntry(zipPath: string, entry: string): Buffer {
  return execFileSync("unzip", ["-p", zipPath, entry], {
    encoding: "buffer",
    maxBuffer: 25 * 1024 * 1024
  }) as Buffer;
}

function listZipEntries(zipPath: string): string[] {
  return execFileSync("unzip", ["-Z1", zipPath], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function findLatestTrace(tracesDir: string): string {
  const entries = readdirSync(tracesDir)
    .filter((name) => /^booking-.*\.zip$/.test(name))
    .map((name) => {
      const fullPath = path.join(tracesDir, name);
      return { fullPath, mtimeMs: statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (entries.length === 0) {
    throw new Error(`No booking trace zips found in ${tracesDir}`);
  }
  return entries[0].fullPath;
}

function parseTraceEvents(traceText: string): TraceEvent[] {
  return traceText
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TraceEvent);
}

function parseStacks(stacksText: string): Map<string, string> {
  const payload = JSON.parse(stacksText) as StacksPayload;
  const byCallId = new Map<string, string>();

  for (const [callIdNumber, frames] of payload.stacks) {
    if (!frames.length) continue;
    const [fileIndex, line, column, fn] = frames[0];
    const file = payload.files[fileIndex];
    byCallId.set(`call@${callIdNumber}`, `${file}:${line}:${column} ${fn}`);
  }

  return byCallId;
}

function getActionMap(events: TraceEvent[]): Map<string, TraceEvent> {
  const beforeEvents = new Map<string, TraceEvent>();
  for (const event of events) {
    if (event.type === "before" && event.callId) {
      beforeEvents.set(event.callId, event);
    }
  }
  return beforeEvents;
}

function summarizeFailures(events: TraceEvent[], sources: Map<string, string>): FailureSummary[] {
  const actions = getActionMap(events);
  const failures: FailureSummary[] = [];

  for (const event of events) {
    if (event.type !== "after" || !event.callId || !event.error?.message) continue;
    const action = actions.get(event.callId);
    failures.push({
      callId: event.callId,
      className: action?.class ?? "unknown",
      method: action?.method ?? "unknown",
      message: event.error.message,
      source: sources.get(event.callId)
    });
  }

  return failures;
}

function summarizeRecentActions(events: TraceEvent[], limit = 12): string[] {
  return events
    .filter((event) => event.type === "before" && event.callId)
    .slice(-limit)
    .map((event) => {
      const time = event.startTime?.toFixed(0) ?? "?";
      const params = event.params ? JSON.stringify(event.params).slice(0, 180) : "";
      return `${time} ${event.callId} ${event.class}.${event.method} ${params}`;
    });
}

function summarizeRecentLogs(events: TraceEvent[], limit = 20): string[] {
  return events
    .filter((event) => event.type === "log" && event.message)
    .slice(-limit)
    .map((event) => {
      const time = event.time?.toFixed(0) ?? "?";
      return `${time} ${event.callId ?? "log"} ${event.message}`;
    });
}

function extractObjectValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const maybeObj = value as { o?: Array<{ k?: string; v?: unknown }> };
  if (!Array.isArray(maybeObj.o)) return null;
  const out: Record<string, unknown> = {};
  for (const item of maybeObj.o) {
    if (item?.k) out[item.k] = decodeValue(item.v);
  }
  return out;
}

function decodeValue(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (typeof record.s === "string") return record.s;
  if (typeof record.b === "boolean") return record.b;
  if (Array.isArray(record.a)) return record.a.map(decodeValue);
  if (Array.isArray(record.o)) return extractObjectValue(record);
  return record;
}

function findModalProbe(events: TraceEvent[]): Record<string, unknown> | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type !== "after") continue;
    const objectValue = extractObjectValue(event.result?.value);
    if (objectValue && ("modalText" in objectValue || "visibleButtons" in objectValue)) {
      return objectValue;
    }
  }
  return null;
}

function printSection(title: string, lines: string[]): void {
  console.log(`\n${title}`);
  for (const line of lines) {
    console.log(line);
  }
}

function getFailureTimes(events: TraceEvent[]): number[] {
  return events
    .filter((event) => event.type === "after" && event.error?.message && typeof event.endTime === "number")
    .map((event) => event.endTime as number);
}

function getFailurePivots(events: TraceEvent[]): Array<{ label: string; time: number }> {
  return events
    .filter((event) => event.type === "after" && event.error?.message && typeof event.endTime === "number")
    .map((event) => ({
      label: `${event.callId ?? "failure"}-${(event.error?.name ?? "error").toLowerCase()}`,
      time: event.endTime as number
    }));
}

function getModalProbeTime(events: TraceEvent[]): number | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type !== "after") continue;
    const objectValue = extractObjectValue(event.result?.value);
    if (objectValue && ("modalText" in objectValue || "visibleButtons" in objectValue)) {
      return event.endTime;
    }
  }
  return undefined;
}

function pickRelevantFrames(events: TraceEvent[]): TraceEvent[] {
  const frames = events.filter((event) => event.type === "screencast-frame" && event.sha1 && typeof event.timestamp === "number");
  if (!frames.length) return [];

  const pivotTimes = [...getFailureTimes(events)];
  const modalTime = getModalProbeTime(events);
  if (typeof modalTime === "number") pivotTimes.push(modalTime);
  if (!pivotTimes.length) {
    return frames.slice(-4);
  }

  const selected = new Map<string, TraceEvent>();
  for (const pivot of pivotTimes.slice(-3)) {
    const nearest = [...frames]
      .sort((a, b) => Math.abs((a.timestamp as number) - pivot) - Math.abs((b.timestamp as number) - pivot))
      .slice(0, 2);
    for (const frame of nearest) {
      if (frame.sha1) selected.set(frame.sha1, frame);
    }
  }

  return [...selected.values()].sort((a, b) => (a.timestamp as number) - (b.timestamp as number)).slice(-6);
}

function getScreenshotPivots(events: TraceEvent[]): Array<{ label: string; time: number }> {
  const pivots = getFailurePivots(events);
  const modalTime = getModalProbeTime(events);
  if (typeof modalTime === "number") {
    pivots.push({ label: "modal-probe", time: modalTime });
  }
  return pivots;
}

function sanitizeLabel(value: string): string {
  return value.replace(/[^a-z0-9@_-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function extractRelevantScreenshots(zipPath: string, events: TraceEvent[]): string[] {
  const frames = pickRelevantFrames(events);
  if (!frames.length) return [];

  const zipEntries = new Set(listZipEntries(zipPath));
  const traceName = path.basename(zipPath, ".zip");
  const outputDir = path.join(path.dirname(zipPath), `${traceName}-screens`);
  const pivots = getScreenshotPivots(events);
  mkdirSync(outputDir, { recursive: true });

  const extracted: string[] = [];
  for (const [index, frame] of frames.entries()) {
    const entry = `resources/${frame.sha1}`;
    if (!frame.sha1 || !zipEntries.has(entry)) continue;
    const buffer = readZipBinaryEntry(zipPath, entry);
    const nearestPivot = pivots.length
      ? [...pivots].sort((a, b) => Math.abs(a.time - (frame.timestamp as number)) - Math.abs(b.time - (frame.timestamp as number)))[0]
      : undefined;
    const suffix = path.extname(frame.sha1) || ".jpeg";
    const baseName = nearestPivot
      ? `${String(index + 1).padStart(2, "0")}-${sanitizeLabel(nearestPivot.label)}-${Math.round(frame.timestamp as number)}${suffix}`
      : `${String(index + 1).padStart(2, "0")}-${path.basename(frame.sha1)}`;
    const filePath = path.join(outputDir, baseName);
    writeFileSync(filePath, buffer);
    extracted.push(filePath);
  }

  return extracted;
}

function main(): void {
  const tracesDir = path.resolve(process.cwd(), "traces");
  const requestedPath = process.argv[2];
  const tracePath = requestedPath
    ? path.resolve(process.cwd(), requestedPath)
    : findLatestTrace(tracesDir);

  if (!existsSync(tracePath)) {
    throw new Error(`Trace not found: ${tracePath}`);
  }

  const events = parseTraceEvents(readZipEntry(tracePath, "trace.trace"));
  const sources = parseStacks(readZipEntry(tracePath, "trace.stacks"));
  const failures = summarizeFailures(events, sources);
  const modalProbe = findModalProbe(events);
  const screenshots = extractRelevantScreenshots(tracePath, events);

  console.log(`Trace: ${tracePath}`);
  console.log(`Events: ${events.length}`);
  console.log(`Failures: ${failures.length}`);

  if (failures.length > 0) {
    printSection("Failures", failures.map((failure) => {
      const source = failure.source ? ` [${failure.source}]` : "";
      return `- ${failure.callId} ${failure.className}.${failure.method}: ${failure.message}${source}`;
    }));
  }

  if (modalProbe) {
    const modalText = typeof modalProbe.modalText === "string" ? modalProbe.modalText : "";
    const visibleButtons = Array.isArray(modalProbe.visibleButtons)
      ? modalProbe.visibleButtons.join(", ")
      : "";
    printSection("Modal Probe", [
      `- modalText: ${JSON.stringify(modalText)}`,
      `- visibleButtons: ${visibleButtons || "(none)"}`
    ]);
  }

  if (screenshots.length > 0) {
    printSection("Screenshots", screenshots.map((filePath) => `- ${filePath}`));
  }

  printSection("Recent Actions", summarizeRecentActions(events));
  printSection("Recent Logs", summarizeRecentLogs(events));
}

main();
