/**
 * Admin broadcast routes
 *
 * POST   /api/v1/admin/broadcast/upload-media — upload file, get Telegram file_id back
 * POST   /api/v1/admin/broadcast           — create + immediately execute a broadcast
 * GET    /api/v1/admin/broadcast           — list broadcast history
 * GET    /api/v1/admin/broadcast/:id       — single broadcast detail
 * DELETE /api/v1/admin/broadcast/:id       — cancel a DRAFT broadcast
 */

import { Router, type IRouter } from "express";
import multer from "multer";
import type { Request } from "express";
import type { FileFilterCallback } from "multer";
import { requireAdmin, requireRole } from "../../middleware/admin-auth.js";
import { AppError } from "../../middleware/error.js";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../lib/env.js";
import { z } from "zod";
import {
  createBroadcast,
  executeBroadcast,
  cancelBroadcast,
  getBroadcastHistory,
  getBroadcastDetail,
  validateBroadcastInput,
  uploadMediaForBroadcast,
  type BroadcastButtons,
  type UploadableMessageType,
} from "../../services/telegram-broadcast.service.js";

export const adminBroadcastRouter: IRouter = Router();
adminBroadcastRouter.use(requireAdmin);

// ── Multer setup for media uploads ───────────────────────────────────────────

const MAX_MEDIA_SIZE = 50 * 1024 * 1024; // 50 MB — Telegram bot API limit

const ALLOWED_MIMES: Record<UploadableMessageType, string[]> = {
  PHOTO:    ["image/jpeg", "image/png", "image/webp", "image/gif"],
  VIDEO:    ["video/mp4", "video/quicktime", "video/mpeg"],
  DOCUMENT: [], // any mime type accepted for documents
};

const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_MEDIA_SIZE },
  fileFilter: (req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    const msgType = (req.query["type"] as string ?? "").toUpperCase() as UploadableMessageType;
    const allowed = ALLOWED_MIMES[msgType];
    // For DOCUMENT type accept everything; for PHOTO/VIDEO enforce MIME
    if (!allowed || allowed.length === 0 || allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new AppError(400, "INVALID_FILE_TYPE", `File type ${file.mimetype} not accepted for ${msgType}`) as never);
    }
  },
});

// ── POST /api/v1/admin/broadcast/upload-media?type=PHOTO|VIDEO|DOCUMENT ──────
// Upload a media file. The backend sends it to the admin's own Telegram chat
// via the bot, captures the file_id Telegram assigns, deletes the staging
// message, and returns the file_id. The admin never needs to copy/paste IDs.

adminBroadcastRouter.post(
  "/upload-media",
  requireRole("SUPER_ADMIN" as never, "ADMIN" as never),
  mediaUpload.single("file"),
  async (req, res, next) => {
    try {
      if (!req.file) throw new AppError(400, "NO_FILE", "No file uploaded");

      const rawType = (req.query["type"] as string ?? "").toUpperCase();
      if (!["PHOTO", "VIDEO", "DOCUMENT"].includes(rawType)) {
        throw new AppError(400, "MISSING_TYPE", "Query param ?type= must be PHOTO, VIDEO, or DOCUMENT");
      }
      const messageType = rawType as UploadableMessageType;

      // Determine the admin's Telegram chat ID from TELEGRAM_ADMIN_IDS.
      // We send the staging upload to the first configured admin ID.
      const firstAdminId = (env.TELEGRAM_ADMIN_IDS ?? "")
        .split(",")
        .map(s => s.trim())
        .find(s => /^\d+$/.test(s));

      if (!firstAdminId) {
        throw new AppError(503, "NO_ADMIN_TELEGRAM_ID",
          "TELEGRAM_ADMIN_IDS is not configured — cannot upload media. Set it in environment variables.");
      }

      const fileId = await uploadMediaForBroadcast(
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname,
        messageType,
        firstAdminId,
      );

      res.json({ success: true, data: { fileId, messageType } });
    } catch (err) {
      next(err);
    }
  },
);

// ── Validation schema ─────────────────────────────────────────────────────────

const buttonSchema = z.object({
  text: z.string().min(1, "Button text cannot be empty").max(64),
  url:  z.string().url("Button URL must be a valid URL"),
});

const broadcastSchema = z.object({
  messageType:  z.enum(["TEXT", "PHOTO", "VIDEO", "DOCUMENT"]),
  text:         z.string().max(4096).optional(),
  caption:      z.string().max(1024).optional(),
  mediaFileId:  z.string().optional(),
  // buttons is an array of rows; each row is an array of {text, url}
  buttons:      z.array(z.array(buttonSchema)).optional(),
});

// ── POST /api/v1/admin/broadcast ──────────────────────────────────────────────
// Creates and immediately executes a broadcast to all registered users.
// Requires SUPER_ADMIN or ADMIN role.

adminBroadcastRouter.post(
  "/",
  requireRole("SUPER_ADMIN" as never, "ADMIN" as never),
  async (req, res, next) => {
    try {
      const parsed = broadcastSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(422, "VALIDATION_ERROR", "Invalid broadcast data", parsed.error.flatten());
      }

      const { messageType, text, caption, mediaFileId, buttons } = parsed.data;

      // Re-use the service's own validation for Telegram-specific limits
      try {
        validateBroadcastInput({
          createdBy:    req.admin!.sub,
          messageType,
          text,
          caption,
          mediaFileId,
          buttons:      buttons as BroadcastButtons | undefined,
          audienceType: "ALL_USERS",
        });
      } catch (validErr) {
        throw new AppError(422, "VALIDATION_ERROR", (validErr as Error).message);
      }

      // Count audience before creating so the admin can see the number
      const recipientCount = await prisma.telegramIdentity.count();

      // Create broadcast record
      const broadcastId = await createBroadcast({
        createdBy:    req.admin!.sub,
        messageType,
        text,
        caption,
        mediaFileId,
        buttons:      buttons as BroadcastButtons | undefined,
        audienceType: "ALL_USERS",
      });

      // Execute asynchronously — don't block the HTTP response waiting for
      // potentially thousands of Telegram sends. Return immediately with the
      // broadcastId; the client can poll GET /:id for status.
      executeBroadcast(broadcastId).catch((err) => {
        // Execution errors are tracked in the Broadcast record itself,
        // so this catch is just a safety net for unhandled rejections.
        console.error({ err, broadcastId }, "executeBroadcast unhandled error");
      });

      res.status(202).json({
        success: true,
        data: {
          broadcastId,
          status:     "SENDING",
          recipientCount,
          message:    `Broadcast is sending to ${recipientCount.toLocaleString()} users.`,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ── GET /api/v1/admin/broadcast ───────────────────────────────────────────────

adminBroadcastRouter.get("/", async (req, res, next) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt((req.query["limit"] as string) ?? "20", 10)));
    const history = await getBroadcastHistory(limit);
    res.json({ success: true, data: history });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/admin/broadcast/:id ──────────────────────────────────────────

adminBroadcastRouter.get("/:id", async (req, res, next) => {
  try {
    const detail = await getBroadcastDetail(req.params["id"] as string);
    if (!detail) throw new AppError(404, "NOT_FOUND", "Broadcast not found");
    res.json({ success: true, data: detail });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/v1/admin/broadcast/:id ───────────────────────────────────────

adminBroadcastRouter.delete(
  "/:id",
  requireRole("SUPER_ADMIN" as never, "ADMIN" as never),
  async (req, res, next) => {
    try {
      await cancelBroadcast(req.params["id"] as string);
      res.json({ success: true, data: { cancelled: true } });
    } catch (err) {
      next(err);
    }
  },
);
