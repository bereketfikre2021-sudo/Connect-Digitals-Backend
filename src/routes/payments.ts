/**
 * Payment routes — customer-facing
 *
 * POST /api/v1/payments/upload-proof   — upload screenshot, returns signed URL
 * POST /api/v1/payments                — submit payment (reference + optional proof key)
 * GET  /api/v1/payments/:id            — get payment detail (owner only)
 * GET  /api/v1/payments/:id/proof      — get signed proof URL (owner only)
 */

import { Router, type IRouter } from "express";
import multer, { type FileFilterCallback } from "multer";
import type { Request } from "express";
import { requireCustomer } from "../middleware/auth.js";
import { AppError } from "../middleware/error.js";
import {
  validateUploadBuffer,
  uploadPaymentProof,
  getSignedProofUrl,
} from "../lib/cloudinary.js";
import { submitPayment } from "../services/payment.service.js";
import { prisma } from "../lib/prisma.js";
import { MAX_PAYMENT_PROOF_SIZE_BYTES, ACCEPTED_PROOF_MIME_TYPES } from "../shared/index.js";
import { z } from "zod";
import { randomUUID } from "crypto";
import { paymentSubmitLimiter } from "../middleware/rateLimit.js";

export const paymentsRouter: IRouter = Router();

paymentsRouter.use(requireCustomer);

// Multer — in-memory storage, size limit enforced by middleware
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PAYMENT_PROOF_SIZE_BYTES },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    const allowed: readonly string[] = ACCEPTED_PROOF_MIME_TYPES;
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new AppError(415, "INVALID_FILE_TYPE", "Only JPEG, PNG, and WebP images are accepted"));
  },
});

/**
 * POST /api/v1/payments/upload-proof
 * Multipart form: field name "screenshot"
 * Returns: { key, signedUrl }
 */
paymentsRouter.post("/upload-proof", paymentSubmitLimiter, upload.single("screenshot"), async (req, res, next) => {
  try {
    if (!req.file) throw new AppError(400, "NO_FILE", "Screenshot file is required");

    validateUploadBuffer(req.file.buffer, req.file.mimetype, req.file.size);

    const result = await uploadPaymentProof(req.file.buffer, req.customer!.sub);

    res.json({
      success: true,
      data: {
        key: result.publicId,
        signedUrl: await getSignedProofUrl(result.publicId),
      },
    });
  } catch (err) {
    next(err);
  }
});

const submitSchema = z.object({
  orderId: z.string().cuid().nullable().optional(),
  paymentMethodId: z.string().cuid(),
  amountETB: z.number().int().positive(),
  reference: z.string().min(1).max(100).trim(),
  screenshotKey: z.string().optional(),
  idempotencyKey: z.string().uuid(),
});

/**
 * POST /api/v1/payments
 * Body: { orderId, paymentMethodId, amountETB, reference, screenshotKey?, idempotencyKey }
 */
paymentsRouter.post("/", paymentSubmitLimiter, async (req, res, next) => {
  try {
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(422, "VALIDATION_ERROR", "Invalid payment data", parsed.error.flatten());
    }

    const { amountETB, screenshotKey, ...rest } = parsed.data;

    const screenshotUrl = screenshotKey
      ? await getSignedProofUrl(screenshotKey)
      : undefined;

    const payment = await submitPayment({
      userId: req.customer!.sub,
      amountETB,
      screenshotKey,
      screenshotUrl,
      ...rest,
      ipAddress: req.ip,
    });

    res.status(201).json({ success: true, data: payment });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/payments/:id
 */
paymentsRouter.get("/:id", async (req, res, next) => {
  try {
    const payment = await prisma.payment.findFirst({
      where: { id: req.params["id"], userId: req.customer!.sub },
      select: {
        id: true,
        orderId: true,
        amountETB: true,
        reference: true,
        status: true,
        rejectionReason: true,
        createdAt: true,
        reviewedAt: true,
        paymentMethod: { select: { name: true } },
      },
    });

    if (!payment) throw new AppError(404, "NOT_FOUND", "Payment not found");
    res.json({ success: true, data: payment });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/payments/:id/proof
 * Returns a fresh signed URL for the customer's own payment proof.
 */
paymentsRouter.get("/:id/proof", async (req, res, next) => {
  try {
    const payment = await prisma.payment.findFirst({
      where: { id: req.params["id"], userId: req.customer!.sub },
      select: { screenshotKey: true },
    });

    if (!payment) throw new AppError(404, "NOT_FOUND", "Payment not found");
    if (!payment.screenshotKey) throw new AppError(404, "NO_PROOF", "No screenshot on file");

    res.json({ success: true, data: { signedUrl: await getSignedProofUrl(payment.screenshotKey) } });
  } catch (err) {
    next(err);
  }
});


