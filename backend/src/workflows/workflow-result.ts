export type WorkflowResult<T, UI = unknown> =
  | { kind: "ok"; value: T }
  | { kind: "needs_user_input"; field: string; ui: UI }
  | { kind: "needs_manual_review"; reason: string }
  | { kind: "temporary_failure"; reason: string }
  | { kind: "permanent_failure"; reason: string };

export function makeOk<T>(value: T): WorkflowResult<T, never> {
  return { kind: "ok", value };
}

export function makeNeedsUserInput<UI>(field: string, ui: UI): WorkflowResult<never, UI> {
  return { kind: "needs_user_input", field, ui };
}
