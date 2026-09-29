/**
 * Whether a caught error is a Postgres unique-constraint violation
 * (SQLSTATE 23505).
 *
 * drizzle-orm wraps the driver's error in its own DrizzleQueryError, so the
 * SQLSTATE ends up on `.cause.code`, not `.code` directly — a plain
 * `error.code === "23505"` check silently never matches and the violation
 * falls through to a generic 500 instead of the intended 409.
 */
export function isUniqueViolation(error: unknown): boolean {
  const err = error as { code?: unknown; cause?: { code?: unknown } } | null | undefined;
  return err?.code === "23505" || err?.cause?.code === "23505";
}
