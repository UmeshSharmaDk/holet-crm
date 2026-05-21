import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import router from "./routes";

const app: Express = express();

// Set security HTTP headers
app.use(helmet());

// Restrict CORS to your specific production domains
const allowedOrigins = [
  "https://crm.outhillsmanali.com", 
  // Allow local development domains if not in strict prod
  ...(process.env.NODE_ENV !== "production" ? ["http://localhost:3000", "http://localhost:8081"] : [])
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

// Global Rate limiting: max 100 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100, 
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." }
});
app.use("/api", limiter);

app.use(express.json({ limit: "5mb" })); // Reduced from 30mb to prevent memory bloat payload attacks
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

app.use("/api", router);

export default app;
