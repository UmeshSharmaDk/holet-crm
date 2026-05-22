import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "path"; // Import path
import router from "./routes";

const app: Express = express();

app.use(helmet());

const allowedOrigins = [
  "https://crm.outhillsmanali.com",
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

// 1. Mount API Routes first
app.use("/api", router);

// 2. Serve the static frontend files (e.g., from mockup-sandbox)
const frontendPath = path.join(__dirname, "../../mockup-sandbox/dist");
app.use(express.static(frontendPath));

// 3. Fallback: send all non-API requests to the React index.html to support client-side routing
app.get("*", (req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

export default app;