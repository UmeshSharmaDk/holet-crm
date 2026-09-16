/**
 * Test environment.
 *
 * Imported before anything that reads configuration at module load — the db
 * pool and the JWT helper both throw on a missing variable, so this has to run
 * first. ESM evaluates imports in source order, so `import "./env.js"` ahead of
 * the app import is what makes that work.
 */
if (!process.env["DATABASE_URL"]) {
  throw new Error(
    "DATABASE_URL must point at a disposable PostgreSQL database to run these tests. " +
      "They truncate every table between suites.",
  );
}

process.env["NODE_ENV"] ??= "test";
process.env["JWT_SECRET"] ??= "test-only-secret-not-used-anywhere-real";

// The global limiter is not what these suites exercise, and its default budget
// is smaller than a full run. The login limiter keeps its real value: it skips
// successful requests, so only the throttling test spends from it.
process.env["RATE_LIMIT_MAX"] ??= "1000000";

// Low enough that the upload budget can be exhausted in a test without
// hundreds of requests, high enough that the other suites never reach it.
process.env["GUEST_UPLOAD_RATE_LIMIT_PER_MINUTE"] ??= "40";
