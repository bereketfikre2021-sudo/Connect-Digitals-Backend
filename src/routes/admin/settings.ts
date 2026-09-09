/**
 * Admin settings routes
 *
 * GET  /api/v1/admin/settings/logo  — get current brand logo URL
 * POST /api/v1/admin/settings/logo  — upload a new brand logo (multipart: field "logo")
 * DELETE /api/v1/admin/settings/logo — remove brand logo (resets to default)
 *
 * The logo is stored in Supabase Storage and the URL is persisted on the
 * AdminUser record of the uploading admin, shared across all admin sessions.
 * Any SUPER_ADMIN or ADMIN can update the logo.
 */

import { Router, type IRouter } from "express";
import multer from "multer";
import type { Request } from "express";
import type { FileFilterCallback } from "multer";
import { requireAdmin } from "../../middleware/admin-auth.js";
import { requireRole } from "../../middleware/admin-auth.js";
import { AppError } from "../../middleware/error.js";
import { validateUploadBuffer, uploadLogoPublic } from "../../lib/cloudinary.js";
import { prisma } from "../../lib/prisma.js";
import { logger } from "../../lib/logger.js";

export const adminSettingsRouter: IRouter = Router();
adminSettingsRouter.use(requireAdmin);

const MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_LOGO_SIZE_BYTES },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/svg+xml"];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new AppError(400, "INVALID_FILE_TYPE", "Only JPEG, PNG, WebP, or SVG logos are accepted") as never);
  },
});

/**
 * GET /api/v1/admin/settings/logo
 * Returns the current brand logo URL (shared across all admin sessions).
 * Reads from any active admin — the logo is global, not per-admin.
 */
adminSettingsRouter.get("/logo", async (_req, res, next) => {
  try {
    // Find the most recently updated logo across all active admins
    const setting = await prisma.adminUser.findFirst({
      where: { isActive: true, brandLogoUrl: { not: null } },
      select: { brandLogoUrl: true },
      orderBy: { updatedAt: "desc" },
    });
    res.json({ success: true, data: { logoUrl: setting?.brandLogoUrl ?? null } });
  } catch (err) { next(err); }
});

/**
 * POST /api/v1/admin/settings/logo
 * Uploads a new brand logo. Requires ADMIN or SUPER_ADMIN role.
 * Multipart: field name "logo".
 */
adminSettingsRouter.post(
  "/logo",
  requireRole("SUPER_ADMIN" as never, "ADMIN" as never),
  logoUpload.single("logo"),
  async (req, res, next) => {
    try {
      if (!req.file) throw new AppError(400, "NO_FILE", "Logo file is required");

      validateUploadBuffer(req.file.buffer, req.file.mimetype, req.file.size);

      const result = await uploadLogoPublic(req.file.buffer, req.file.mimetype);

      // Persist the URL on the uploading admin's record
      await prisma.adminUser.update({
        where: { id: req.admin!.sub },
        data:  { brandLogoUrl: result.publicUrl },
      });

      logger.info({ adminId: req.admin!.sub, logoUrl: result.publicUrl }, "Brand logo updated");

      res.json({ success: true, data: { logoUrl: result.publicUrl } });
    } catch (err) { next(err); }
  }
);

/**
 * DELETE /api/v1/admin/settings/logo
 * Removes the brand logo for all admins (resets to default "CD" placeholder).
 */
adminSettingsRouter.delete(
  "/logo",
  requireRole("SUPER_ADMIN" as never, "ADMIN" as never),
  async (_req, res, next) => {
    try {
      await prisma.adminUser.updateMany({
        where: { isActive: true },
        data:  { brandLogoUrl: null },
      });
      res.json({ success: true, data: { logoUrl: null } });
    } catch (err) { next(err); }
  }
);
