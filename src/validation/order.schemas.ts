import { z } from "zod";
import { TargetType } from "../shared/index.js";
import { uuidSchema, urlSchema } from "./common.js";

export const createOrderSchema = z.object({
  packageId: uuidSchema,
  targetUrl: urlSchema,
  targetType: z.nativeEnum(TargetType),
  notes: z.string().max(500).optional(),
});

export const orderIdSchema = z.object({
  orderId: uuidSchema,
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;


