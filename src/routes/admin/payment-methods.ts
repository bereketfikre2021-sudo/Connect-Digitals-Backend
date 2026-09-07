/**
 * Admin payment-methods routes
 *
 * GET    /api/v1/admin/payment-methods               — list all (active + inactive)
 * POST   /api/v1/admin/payment-methods/upload-logo   — upload logo image, returns signed URL
 * POST   /api/v1/admin/payment-methods               — create new method
 * PATCH  /api/v1/admin/payment-methods/:id           — update method
 * DELETE /api/v1/admin/payment-methods/:id           — soft-deactivate
 */

import { Router, type IRouter } from "express";
import multer, { type FileFilterCallback } from "multer";
import type { Request } from "express";
import { requireAdmin, requireRole } from "../../middleware/admin-auth.js";
import { AppError } from "../../middleware/error.js";
import { prisma } from "../../lib/prisma.js";
import { z } from "zod";
import {
  validateUploadBuffer,
  uploadPaymentProof,
} from "../../lib/cloudinary.js";

// ── Multer for logo uploads ───────────────────────────────────────────────────
const MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

function logoFileFilter(_req: Request, file: Express.Multer.File, cb: FileFilterCallback) {
  const allowed = ["image/jpeg", "image/png", "image/webp", "image/svg+xml"];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new AppError(400, "INVALID_FILE_TYPE", "Only JPEG, PNG, WebP, or SVG logos are accepted") as never);
}

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_LOGO_SIZE_BYTES },
  fileFilter: logoFileFilter,
});

export const adminPaymentMethodsRouter: IRouter = Router();
adminPaymentMethodsRouter.use(requireAdmin);

// ── Upload logo ───────────────────────────────────────────────────────────────
/**
 * POST /api/v1/admin/payment-methods/upload-logo
 * Multipart: field name "logo"
 * Returns: { key, signedUrl }
 */
adminPaymentMethodsRouter.post(
  "/upload-logo",
  requireRole("SUPER_ADMIN" as never, "ADMIN" as never),
  logoUpload.single("logo"),
  async (req, res, next) => {
    try {
      if (!req.file) throw new AppError(400, "NO_FILE", "Logo file is required");
      validateUploadBuffer(req.file.buffer, req.file.mimetype, req.file.size);
      // Reuse the same upload path under a dedicated "admin" user ID to keep logos separate
      const result = await uploadPaymentProof(req.file.buffer, "admin-logos");
      res.json({ success: true, data: { key: result.publicId, signedUrl: result.secureUrl } });
    } catch (err) { next(err); }
  }
);

// ── List ─────────────────────────────────────────────────────────────────────
adminPaymentMethodsRouter.get("/", async (_req, res, next) => {
  try {
    const methods = await prisma.paymentMethod.findMany({
      orderBy: { sortOrder: "asc" },
      select: {
        id: true, name: true, description: true,
        accountName: true, accountNumber: true, bankName: true,
        instructions: true, isActive: true, sortOrder: true,
        createdAt: true, updatedAt: true,
        _count: { select: { payments: true } },
      },
    });
    res.json({ success: true, data: methods });
  } catch (err) { next(err); }
});

// ── Create ────────────────────────────────────────────────────────────────────
const methodSchema = z.object({
  name:          z.string().min(1).max(100),
  description:   z.string().max(2000).optional(),
  accountName:   z.string().min(1).max(200),
  accountNumber: z.string().min(1).max(100),
  bankName:      z.string().max(100).optional(),
  instructions:  z.string().min(1).max(2000),
  sortOrder:     z.number().int().min(0).optional().default(0),
  isActive:      z.boolean().optional().default(true),
});

adminPaymentMethodsRouter.post(
  "/",
  requireRole("SUPER_ADMIN" as never, "ADMIN" as never),
  async (req, res, next) => {
    try {
      const parsed = methodSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid method data", parsed.error.flatten());

      const method = await prisma.paymentMethod.create({ data: parsed.data as never });
      res.status(201).json({ success: true, data: method });
    } catch (err) { next(err); }
  }
);

// ── Update ────────────────────────────────────────────────────────────────────
const updateMethodSchema = methodSchema.partial();

adminPaymentMethodsRouter.patch(
  "/:id",
  requireRole("SUPER_ADMIN" as never, "ADMIN" as never),
  async (req, res, next) => {
    try {
      const parsed = updateMethodSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid update data", parsed.error.flatten());

      const existing = await prisma.paymentMethod.findUnique({ where: { id: req.params["id"] as string } });
      if (!existing) throw new AppError(404, "NOT_FOUND", "Payment method not found");

      const updated = await prisma.paymentMethod.update({
        where: { id: req.params["id"] as string },
        data: parsed.data as never,
      });
      res.json({ success: true, data: updated });
    } catch (err) { next(err); }
  }
);

// ── Deactivate (soft delete) ──────────────────────────────────────────────────
adminPaymentMethodsRouter.delete(
  "/:id",
  requireRole("SUPER_ADMIN" as never),
  async (req, res, next) => {
    try {
      const existing = await prisma.paymentMethod.findUnique({ where: { id: req.params["id"] as string } });
      if (!existing) throw new AppError(404, "NOT_FOUND", "Payment method not found");

      await prisma.paymentMethod.update({
        where: { id: req.params["id"] as string },
        data: { isActive: false },
      });
      res.json({ success: true, data: { deactivated: true } });
    } catch (err) { next(err); }
  }
);
