/**
 * Payment methods routes — public, no auth required
 *
 * GET /api/v1/payment-methods   — all active payment methods
 * GET /api/v1/payment-methods/:id — single method
 *
 * Account numbers and instructions come from the DB, never hardcoded.
 * Logo URLs are refreshed on every request so they never expire client-side.
 */

import { Router, type IRouter } from "express";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../middleware/error.js";
import { refreshLogoUrl } from "../lib/cloudinary.js";

export const paymentMethodsRouter: IRouter = Router();

/**
 * Parse the storagePath out of the description JSON blob.
 * The description field stores: { logoUrl: "<signedOrPublicUrl>", text: "..." }
 * We store the storagePath separately so we can refresh the URL.
 * If there's no storagePath we fall back to refreshing whatever URL is in logoUrl.
 */
async function hydrateDescription(description: string | null): Promise<string | null> {
  if (!description) return null;
  try {
    const parsed = JSON.parse(description) as { logoUrl?: string; storagePath?: string; text?: string };

    let freshUrl: string | undefined;

    if (parsed.storagePath) {
      // Preferred: regenerate from the canonical storage path
      freshUrl = await refreshLogoUrl(parsed.storagePath);
    } else if (parsed.logoUrl) {
      // Legacy logos: extract the path from the signed URL and regenerate
      // Signed URL format: https://<project>.supabase.co/storage/v1/object/sign/<bucket>/<path>?token=...
      const match = parsed.logoUrl.match(/\/object\/sign\/[^/]+\/(.+?)\?/);
      if (match?.[1]) {
        const storagePath = decodeURIComponent(match[1]);
        freshUrl = await refreshLogoUrl(storagePath);
        // Store the storagePath back so next saves persist it
        parsed.storagePath = storagePath;
      } else {
        // Public URL or unknown format — return as-is
        freshUrl = parsed.logoUrl;
      }
    }

    if (freshUrl) {
      parsed.logoUrl = freshUrl;
    }

    return JSON.stringify(parsed);
  } catch {
    return description; // malformed JSON — return raw to avoid breaking anything
  }
}

paymentMethodsRouter.get("/", async (_req, res, next) => {
  try {
    const methods = await prisma.paymentMethod.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        accountName: true,
        accountNumber: true,
        bankName: true,
        instructions: true,
        sortOrder: true,
      },
    });

    // Refresh all logo URLs in parallel
    const hydrated = await Promise.all(
      methods.map(async (m) => ({
        ...m,
        description: await hydrateDescription(m.description),
      }))
    );

    res.json({ success: true, data: hydrated });
  } catch (err) {
    next(err);
  }
});

paymentMethodsRouter.get("/:id", async (req, res, next) => {
  try {
    const method = await prisma.paymentMethod.findFirst({
      where: { id: req.params["id"], isActive: true },
      select: {
        id: true,
        name: true,
        description: true,
        accountName: true,
        accountNumber: true,
        bankName: true,
        instructions: true,
      },
    });
    if (!method) throw new AppError(404, "NOT_FOUND", "Payment method not found");

    const hydrated = { ...method, description: await hydrateDescription(method.description) };
    res.json({ success: true, data: hydrated });
  } catch (err) {
    next(err);
  }
});
