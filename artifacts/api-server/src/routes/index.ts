import { Router } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import hotelsRouter from "./hotels.js";
import usersRouter from "./users.js";
import agenciesRouter from "./agencies.js";
import bookingsRouter from "./bookings.js";
import dashboardRouter from "./dashboard.js";
import analyticsRouter from "./analytics.js";
import aiRouter from "./ai.js";

const router = Router();

router.use("/", healthRouter);
router.use("/auth", authRouter);
router.use("/hotels", hotelsRouter);
router.use("/users", usersRouter);
router.use("/agencies", agenciesRouter);
router.use("/bookings", bookingsRouter);
router.use("/dashboard", dashboardRouter);
router.use("/analytics", analyticsRouter);
router.use("/ai", aiRouter);

export default router;
