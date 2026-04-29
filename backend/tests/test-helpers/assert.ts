export type TestResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function assertOk<T>(result: TestResult<T>): T {
  if (!result.ok) {
    throw new Error(`Expected ok result, got error: ${result.error}`);
  }

  return result.value;
}
