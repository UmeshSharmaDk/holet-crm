import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import router from "./routes";

const app: Express = express();

app.use(helmet());
app.set("trust proxy", 1);

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

app.use(
  cors({
    origin: (origin, callback) => {
      const isLocalPreview = process.env.NODE_ENV !== "production" && !!origin && /^http:\/\/localhost:\d+$/.test(origin);
      const isReplitPreview = process.env.NODE_ENV !== "production" && !!origin && /^https?:\/\/[^/]+\.replit\.dev(?::\d+)?$/.test(origin);
      if (!origin || allowedOrigins.includes(origin) || isLocalPreview || isReplitPreview) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." }
});
app.use("/api", limiter);

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

// ADD THIS: Root Health Check Route
app.get("/", (req, res) => {
  res.status(200).json({
    service: "Holet CRM API",
    status: "Operational",
    timestamp: new Date().toISOString()
  });
});

app.use("/api", router);

export default app;