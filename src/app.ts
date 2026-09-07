import express, { type Application } from "express";
import helmet from "helmet";
import cors from "cors";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { env } from "./lib/env.js";
import { globalLimiter } from "./middleware/rateLimit.js";
import { errorHandler, notFound } from "./middleware/error.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Customer routes
import { authRouter } from "./routes/auth.js";
import { servicesRouter } from "./routes/services.js";
import { ordersRouter } from "./routes/orders.js";
import { walletRouter } from "./routes/wallet.js";
import { paymentsRouter } from "./routes/payments.js";
import { paymentMethodsRouter } from "./routes/payment-methods.js";
import { reportsRouter } from "./routes/reports.js";

// Admin routes
import { adminAuthRouter } from "./routes/admin/auth.js";
import { adminPaymentsRouter } from "./routes/admin/payments.js";
import { adminFulfillmentRouter } from "./routes/admin/fulfillment.js";
import { adminWalletRouter } from "./routes/admin/wallet.js";
import { adminOrdersRouter } from "./routes/admin/orders.js";
import { adminStatsRouter } from "./routes/admin/stats.js";
import { adminCustomersRouter } from "./routes/admin/customers.js";
import { adminCampaignsRouter } from "./routes/admin/campaigns.js";
import { adminReportsRouter } from "./routes/admin/reports.js";
import { adminAnalyticsRouter } from "./routes/admin/analytics.js";
import { adminPaymentMethodsRouter } from "./routes/admin/payment-methods.js";
import { adminServicesRouter } from "./routes/admin/services.js";

const app: Application = express();

// Trust ngrok/reverse proxy headers
app.set("trust proxy", 1);

// ── Security ─────────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://telegram.org", "'unsafe-inline'"],
      scriptSrcElem: ["'self'", "https://telegram.org", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https:"],
    },
  },
}));

// ── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = env.CORS_ALLOWED_ORIGINS.split(",").map((o) => o.trim());
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes("*")) {
        cb(null, true);
      } else {
        cb(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// ── Rate limiting ─────────────────────────────────────────────────────────────
app.use(globalLimiter);

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── Customer routes ───────────────────────────────────────────────────────────
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/services", servicesRouter);
app.use("/api/v1/orders", ordersRouter);
app.use("/api/v1/wallet", walletRouter);
app.use("/api/v1/payments", paymentsRouter);
app.use("/api/v1/payment-methods", paymentMethodsRouter);
app.use("/api/v1/reports", reportsRouter);

// ── Admin routes ──────────────────────────────────────────────────────────────
app.use("/api/v1/admin/auth", adminAuthRouter);
app.use("/api/v1/admin/payments", adminPaymentsRouter);
app.use("/api/v1/admin/fulfillment", adminFulfillmentRouter);
app.use("/api/v1/admin/wallets", adminWalletRouter);
app.use("/api/v1/admin/orders", adminOrdersRouter);
app.use("/api/v1/admin/stats", adminStatsRouter);
app.use("/api/v1/admin/customers", adminCustomersRouter);
app.use("/api/v1/admin/campaigns", adminCampaignsRouter);
app.use("/api/v1/admin/reports", adminReportsRouter);
app.use("/api/v1/admin/analytics", adminAnalyticsRouter);
app.use("/api/v1/admin/payment-methods", adminPaymentMethodsRouter);
app.use("/api/v1/admin/services", adminServicesRouter);

// ── Serve Mini App static build ───────────────────────────────────────────────
// The built Mini App is at ../mini-app/dist relative to the backend src/ folder
const miniAppDist = join(__dirname, "../../mini-app/dist");
app.use(express.static(miniAppDist));

// ── API 404 (only for /api routes) ────────────────────────────────────────────
app.use("/api", notFound);

// ── SPA fallback — serve index.html for all non-API routes ───────────────────
app.get("*", (_req, res) => {
  res.sendFile(join(miniAppDist, "index.html"));
});

app.use(errorHandler);

export { app };


