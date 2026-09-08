/**
 * Storage service — payment proof upload and signed URL generation.
 * Uses Supabase Storage (private bucket) instead of Cloudinary.
 *
 * Files are uploaded to the PAYMENT_PROOFS_BUCKET which must be configured
 * as a PRIVATE bucket in Supabase — public access is disabled.
 * Access is only via time-limited signed URLs generated server-side.
 *
 * Named cloudinary.ts intentionally to avoid changing all import paths.
 */

import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";
import { AppError } from "../middleware/error.js";
import { randomUUID } from "crypto";

// Re-export pure validator (no env dependency — safe for unit tests)
export { validateUploadBuffer, UploadValidationError } from "./upload-validator.js";

const BUCKET = "payment-proofs";

export const ACCEPTED_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];

// Service-role client factory — server-side only, never sent to the browser
function getStorage() {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new AppError(500, "STORAGE_NOT_CONFIGURED", "Supabase storage is not configured");
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  }).storage;
}

export interface UploadResult {
  publicId: string;  // Storage path — used as the key everywhere screenshotKey is stored
  secureUrl: string; // Short-lived signed URL (1 hour)
  format: string;
  bytes: number;
}

/**
 * Uploads a payment proof buffer to Supabase Storage (private bucket).
 */
export async function uploadPaymentProof(
  buffer: Buffer,
  userId: string
): Promise<UploadResult> {
  const storage = getStorage();
  const storagePath = `${userId}/${randomUUID()}.jpg`;

  const { error } = await storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: "image/jpeg", upsert: false });

  if (error) {
    throw new AppError(500, "UPLOAD_FAILED", `Failed to upload payment proof: ${error.message}`);
  }

  const signedUrl = await getSignedProofUrl(storagePath);

  return { publicId: storagePath, secureUrl: signedUrl, format: "jpg", bytes: buffer.length };
}

/**
 * Generates a signed, time-limited URL for a private payment proof.
 * Call server-side only for verified admin/owner access.
 */
export async function getSignedProofUrl(
  publicId: string,
  expiresIn = 3600
): Promise<string> {
  const storage = getStorage();
  const { data, error } = await storage.from(BUCKET).createSignedUrl(publicId, expiresIn);

  if (error || !data?.signedUrl) {
    throw new AppError(500, "SIGNED_URL_FAILED", "Failed to generate signed URL for payment proof");
  }

  return data.signedUrl;
}

/**
 * Uploads a logo image to a PUBLIC Supabase Storage bucket.
 * Returns a permanent, non-expiring public URL — suitable for brand
 * logos that are not sensitive (unlike payment screenshots).
 *
 * The bucket "payment-method-logos" must be created in Supabase with
 * public access enabled. If it doesn't exist yet, falls back to
 * generating a long-lived signed URL (24h) from the private bucket.
 */
export async function uploadLogoPublic(
  buffer: Buffer,
  mimetype: string
): Promise<{ publicUrl: string; storagePath: string }> {
  const storage = getStorage();
  const ext = mimetype === "image/svg+xml" ? "svg"
    : mimetype === "image/png"  ? "png"
    : mimetype === "image/webp" ? "webp"
    : "jpg";
  const storagePath = `logos/${randomUUID()}.${ext}`;
  const PUBLIC_BUCKET = "payment-method-logos";

  // Try public bucket first
  const { error: uploadError } = await storage
    .from(PUBLIC_BUCKET)
    .upload(storagePath, buffer, { contentType: mimetype, upsert: false });

  if (!uploadError) {
    // Get permanent public URL
    const { data } = storage.from(PUBLIC_BUCKET).getPublicUrl(storagePath);
    return { publicUrl: data.publicUrl, storagePath };
  }

  // Fallback: use the private payment-proofs bucket with a 365-day signed URL
  // This handles the case where the public bucket hasn't been created yet.
  const { error: fallbackError } = await storage
    .from(BUCKET)
    .upload(`admin-logos/${storagePath}`, buffer, { contentType: mimetype, upsert: false });

  if (fallbackError) {
    throw new AppError(500, "UPLOAD_FAILED", `Failed to upload logo: ${fallbackError.message}`);
  }

  const { data: signedData, error: signErr } = await storage
    .from(BUCKET)
    .createSignedUrl(`admin-logos/${storagePath}`, 365 * 24 * 3600); // 1 year

  if (signErr || !signedData?.signedUrl) {
    throw new AppError(500, "SIGNED_URL_FAILED", "Failed to generate logo URL");
  }

  return { publicUrl: signedData.signedUrl, storagePath: `admin-logos/${storagePath}` };
}
/**
 * Generates a fresh signed URL for a logo stored in the private payment-proofs bucket.
 * Logos are stored at paths like "admin-logos/logos/uuid.jpg".
 * Returns the storagePath unchanged if Supabase isn't configured (dev/test).
 */
export async function refreshLogoUrl(storagePath: string, expiresIn = 3600): Promise<string> {
  try {
    const storage = getStorage();
    const { data, error } = await storage.from(BUCKET).createSignedUrl(storagePath, expiresIn);
    if (!error && data?.signedUrl) return data.signedUrl;
    return storagePath;
  } catch {
    return storagePath; // fail gracefully — never break the route for a logo
  }
}

export async function deletePaymentProof(publicId: string): Promise<void> {
  try {
    const storage = getStorage();
    await storage.from(BUCKET).remove([publicId]);
  } catch {
    // Log but don't throw — deletion failure is not critical
  }
}


