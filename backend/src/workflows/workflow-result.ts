export type WorkflowResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "needs_user_input"; field: string; ui: unknown }
  | { kind: "needs_manual_review"; reason: string }
  | { kind: "temporary_failure"; reason: string }
  | { kind: "permanent_failure"; reason: string };

export function makeOk<T>(value: T): WorkflowResult<T> {
  return { kind: "ok", value };
}

export function makeNeedsUserInput(field: string, ui: unknown): WorkflowResult<never> {
  return { kind: "needs_user_input", field, ui };
}
