import rateLimit from "express-rate-limit";
import { RATE_LIMIT } from "../shared/index.js";

export const globalLimiter = rateLimit({
  windowMs: RATE_LIMIT.global.windowMs,
  max: RATE_LIMIT.global.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: "RATE_LIMITED", message: "Too many requests" } },
});

export const authLimiter = rateLimit({
  windowMs: RATE_LIMIT.auth.windowMs,
  max: RATE_LIMIT.auth.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: "RATE_LIMITED", message: "Too many authentication attempts" } },
});

export const paymentSubmitLimiter = rateLimit({
  windowMs: RATE_LIMIT.paymentSubmit.windowMs,
  max: RATE_LIMIT.paymentSubmit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: "RATE_LIMITED", message: "Too many payment submissions. Please wait before trying again." } },
});


