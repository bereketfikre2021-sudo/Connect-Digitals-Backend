/**
 * Order service — business logic for order creation.
 *
 * IMPORTANT: The total amount is ALWAYS computed from the Package record
 * in the database. The client never supplies the price.
 */

import { prisma } from "../lib/prisma.js";
import { AppError } from "../middleware/error.js";
import { ORDER_NUMBER_PREFIX, ORDER_NUMBER_START } from "../shared/index.js";

/**
 * Generates a human-readable order number like CD10001.
 *
 * Uses prisma.order.count() as a base — cheap and usually unique.
 * If two concurrent creates collide on the @unique constraint (P2002),
 * createOrder catches it and retries with a fresh count (see below).
 */
async function generateOrderNumber(): Promise<string> {
  const count = await prisma.order.count();
  const num = ORDER_NUMBER_START + count;
  return `${ORDER_NUMBER_PREFIX}${num}`;
}

export interface CreateOrderInput {
  userId: string;
  packageId: string;
  targetUrl: string;
  targetType: string;
  notes?: string;
}

export async function createOrder(input: CreateOrderInput) {
  // Load the package + service from DB — price is authoritative here
  const pkg = await prisma.servicePackage.findUnique({
    where: { id: input.packageId },
    include: {
      service: {
        select: {
          id: true,
          isActive: true,
          requiresTargetUrl: true,
          targetType: true,
          fulfillmentType: true,
        },
      },
    },
  });

  if (!pkg || !pkg.isActive) {
    throw new AppError(404, "PACKAGE_NOT_FOUND", "Package not found or inactive");
  }
  if (!pkg.service.isActive) {
    throw new AppError(400, "SERVICE_INACTIVE", "This service is currently unavailable");
  }
  if (pkg.service.requiresTargetUrl && !input.targetUrl) {
    throw new AppError(400, "TARGET_URL_REQUIRED", "A target URL is required for this service");
  }

  // Authoritative price from DB
  const totalAmountETB = pkg.priceETB * 1; // quantity is always 1 package

  const orderData = {
    userId: input.userId,
    serviceId: pkg.service.id,
    packageId: pkg.id,
    targetUrl: input.targetUrl,
    targetType: input.targetType as never,
    quantity: pkg.quantity,
    unitPriceETB: pkg.priceETB,
    totalAmountETB,
    orderStatus: "PENDING_PAYMENT" as never,
    paymentStatus: "PENDING" as never,
    fulfillmentStatus: "PENDING" as never,
    notes: input.notes,
  };

  const select = {
    id: true,
    orderNumber: true,
    targetUrl: true,
    targetType: true,
    quantity: true,
    unitPriceETB: true,
    totalAmountETB: true,
    orderStatus: true,
    paymentStatus: true,
    fulfillmentStatus: true,
    createdAt: true,
    service: { select: { id: true, name: true, slug: true, platform: { select: { name: true, slug: true } } } },
    package: { select: { id: true, name: true, quantity: true, priceETB: true, deliveryDaysMin: true, deliveryDaysMax: true } },
  };

  // Generate order number and create — retry once if there is a concurrent
  // duplicate (P2002 on orderNumber unique constraint).
  let order;
  try {
    const orderNumber = await generateOrderNumber();
    order = await prisma.order.create({ data: { orderNumber, ...orderData }, select });
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      // Retry with a fresh count — offset by 1 to skip the colliding number
      const count2 = await prisma.order.count();
      const orderNumber2 = `${ORDER_NUMBER_PREFIX}${ORDER_NUMBER_START + count2}`;
      order = await prisma.order.create({ data: { orderNumber: orderNumber2, ...orderData }, select });
    } else {
      throw err;
    }
  }

  return order;
}


