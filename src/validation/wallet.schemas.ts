import { z } from "zod";
import { uuidSchema, positiveInt } from "./common.js";
import { MIN_DEPOSIT_AMOUNT } from "../shared/index.js";

export const depositSchema = z.object({
  paymentMethodId: uuidSchema,
  amount: positiveInt.min(MIN_DEPOSIT_AMOUNT, `Minimum deposit is ${MIN_DEPOSIT_AMOUNT / 100} ETB`),
  idempotencyKey: uuidSchema,
});

export type DepositInput = z.infer<typeof depositSchema>;


