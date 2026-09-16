import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { PostgresRateLimitStore } from "./lib/rateLimitStore.js";
import router from "./routes";

const app: Express = express();

/**
 * Number of reverse proxies in front of this app.
 *
 * express-rate-limit keys on req.ip. With `trust proxy` unset every request
 * behind the platform router carries the router's address, so all clients share
 * one bucket and a single caller can lock out the whole tenant base. Trusting
 * the header unconditionally (`true`) is the opposite failure: the key becomes
 * an attacker-supplied X-Forwarded-For and the limit stops applying at all.
 * A specific hop count trusts exactly the proxies that are really there.
 */
const trustProxyHops = Number(process.env["TRUST_PROXY_HOPS"] ?? 1);
app.set("trust proxy", Number.isInteger(trustProxyHops) && trustProxyHops >= 0 ? trustProxyHops : 1);

app.disable("x-powered-by");
app.use(helmet());

const proxyDomains = [
  process.env.REPLIT_DEV_DOMAIN,
  ...(process.env.REPLIT_DOMAINS ?? "").split(","),
]
  .filter((domain): domain is string => Boolean(domain))
  .map((domain) => domain.startsWith("http") ? domain : `https://${domain}`);
const allowedOrigins = [
  "https://crm.outhillsmanali.com",
  ...proxyDomains,
  ...(process.env.NODE_ENV !== "production" ? ["http://localhost:3000", "http://localhost:8081"] : [])
];

class CorsError extends Error {}

app.use(
  cors({
    origin: (origin, callback) => {
      const isLocalPreview = process.env.NODE_ENV !== "production" && !!origin && /^http:\/\/localhost:\d+$/.test(origin);
      const isReplitPreview = process.env.NODE_ENV !== "production" && !!origin && /^https?:\/\/[^/]+\.replit\.dev(?::\d+)?$/.test(origin);
      if (!origin || allowedOrigins.includes(origin) || isLocalPreview || isReplitPreview) {
        callback(null, true);
      } else {
        callback(new CorsError("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

// Deliberately left on the in-process store. This runs on every request, so a
// shared store would put a database round-trip in front of all traffic, and
// the guarantee it provides — crude flood protection — degrades gracefully
// when it is per-instance. The limiters where the count actually has to hold
// are backed by the database instead.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env["RATE_LIMIT_MAX"] ?? 300),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too Many Requests", message: "Too many requests, please try again later." }
});

/**
 * Collapses an address to a single rate-limit key.
 *
 * IPv6 clients are routinely handed a whole /64, so keying on the full address
 * would let one host cycle through addresses and never hit the limit. Only the
 * network prefix is significant.
 */
function clientKey(ip: string): string {
  if (!ip.includes(":")) return ip;
  return ip.split(":").slice(0, 4).join(":") + "::/64";
}

/**
 * Credential stuffing budget, separate from and far tighter than the general
 * limiter — otherwise password guessing is bounded only by the shared bucket.
 * Keyed on client address plus the account being tried, so one attacker cannot
 * spend every account's budget and lock legitimate users out.
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env["LOGIN_RATE_LIMIT_MAX"] ?? 10),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  // Shared and durable: a restart or a second instance must not hand an
  // attacker a fresh allowance against the same account.
  store: new PostgresRateLimitStore("login"),
  keyGenerator: (req) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    return `${clientKey(req.ip ?? "unknown")}|${email}`;
  },
  message: { error: "Too Many Requests", message: "Too many login attempts, please try again later." },
});

// Applies to every route, including the root health check, so no path is
// reachable at unbounded rate.
app.use(limiter);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.get("/", (_req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/api/auth/login", loginLimiter);
app.use("/api", router);

// Unrouted paths get a JSON 404 rather than Express's default HTML page.
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not Found" });
});

// Single JSON error shape for everything that throws, including rejected CORS
// preflights and malformed request bodies.
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) return;

  if (err instanceof CorsError) {
    res.status(403).json({ error: "Forbidden", message: "Origin not allowed" });
    return;
  }
  if (err?.type === "entity.too.large" || err?.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: "Payload Too Large", message: "Request body is too large" });
    return;
  }
  if (err?.type === "entity.parse.failed" || err instanceof SyntaxError) {
    res.status(400).json({ error: "Bad Request", message: "Malformed request body" });
    return;
  }
  if (err?.name === "MulterError" || err?.message === "Unsupported audio format") {
    res.status(400).json({ error: "Bad Request", message: err.message });
    return;
  }

  console.error("[unhandled]", err);
  res.status(500).json({ error: "Internal Server Error" });
});

export default app;
