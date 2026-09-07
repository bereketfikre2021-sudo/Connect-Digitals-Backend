/**
 * Pure file validation — no env or DB dependencies.
 * Extracted so unit tests can import it without triggering env.ts.
 */

import { MAX_PAYMENT_PROOF_SIZE_BYTES, ACCEPTED_PROOF_MIME_TYPES } from "../shared/index.js";

export class UploadValidationError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "UploadValidationError";
  }
}

export function validateUploadBuffer(
  buffer: Buffer,
  originalMime: string,
  sizeBytes: number
): void {
  // Size check first (cheapest)
  if (sizeBytes > MAX_PAYMENT_PROOF_SIZE_BYTES) {
    throw new UploadValidationError(
      413,
      "FILE_TOO_LARGE",
      `File exceeds maximum allowed size of ${MAX_PAYMENT_PROOF_SIZE_BYTES / (1024 * 1024)}MB`
    );
  }

  // MIME type check
  const allowedMimes: readonly string[] = ACCEPTED_PROOF_MIME_TYPES;
  if (!allowedMimes.includes(originalMime)) {
    throw new UploadValidationError(
      415,
      "INVALID_FILE_TYPE",
      `Only JPEG, PNG, and WebP images are accepted`
    );
  }

  // Magic byte check
  const magic = buffer.subarray(0, 4);
  const isJpeg = magic[0] === 0xff && magic[1] === 0xd8;
  const isPng  = magic[0] === 0x89 && magic[1] === 0x50 && magic[2] === 0x4e && magic[3] === 0x47;
  const isWebp = magic[0] === 0x52 && magic[1] === 0x49 && magic[2] === 0x46 && magic[3] === 0x46;

  if (!isJpeg && !isPng && !isWebp) {
    throw new UploadValidationError(415, "INVALID_FILE_CONTENT", "File content does not match an accepted image format");
  }
}


