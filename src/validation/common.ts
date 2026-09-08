import { z } from "zod";

/** UUID v4 string */
export const uuidSchema = z.string().uuid();

/** CUID / CUID2 / UUID — any non-empty opaque ID string used as a DB primary key.
 *  Prisma uses CUIDs by default (@default(cuid())), which are NOT UUIDs.
 *  This validator accepts any non-empty string; the DB query will reject
 *  unknown IDs with a 404, so we don't need strict format checking here.
 */
export const cuidSchema = z.string().min(1, "ID is required").max(128);

/** Positive integer (quantities, amounts in cents) */
export const positiveInt = z.number().int().positive();

/** Non-negative integer (balances) */
export const nonNegativeInt = z.number().int().min(0);

/** Safe URL */
export const urlSchema = z
  .string()
  .url()
  .max(2048, "URL must be 2048 characters or fewer");

/** Pagination */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});


