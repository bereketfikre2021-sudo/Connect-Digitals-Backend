/**
 * Admin broadcast routes
 *
 * POST   /api/v1/admin/broadcast           — create + immediately execute a broadcast
 * GET    /api/v1/admin/broadcast           — list broadcast history
 * GET    /api/v1/admin/broadcast/:id       — single broadcast detail
 * DELETE /api/v1/admin/broadcast/:id       — cancel a DRAFT broadcast
 */

import { Router, type IRouter } from "express";
import { requireAdmin, requireRole } from "../../middleware/admin-auth.js";
import { AppError } from "../../middleware/error.js";
import { prisma } from "../../lib/prisma.js";
import { z } from "zod";
import {
  createBroadcast,
  executeBroadcast,
  cancelBroadcast,
  getBroadcastHistory,
  getBroadcastDetail,
  validateBroadcastInput,
  type BroadcastButtons,
} from "../../services/telegram-broadcast.service.js";

export const adminBroadcastRouter: IRouter = Router();
adminBroadcastRouter.use(requireAdmin);

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
