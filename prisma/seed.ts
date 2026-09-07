/**
 * Prisma seed script — Phase 1 reference data.
 *
 * Seeds:
 *  - Platforms (TikTok, Instagram, Facebook, YouTube, Telegram, Website)
 *  - Promotion services with correct targetType per service
 *  - Service packages (sample pricing per service)
 *  - Payment methods (CBE, Awash Bank, Telebirr)
 *  - Bootstrap SUPER_ADMIN from env
 *
 * Run: pnpm db:seed
 */

import { PrismaClient, FulfillmentType, TargetType } from "@prisma/client";

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function etb(amount: number): number {
  // Convert whole ETB to cents
  return Math.round(amount * 100);
}

// ---------------------------------------------------------------------------
// Platform definitions
// ---------------------------------------------------------------------------

const PLATFORMS = [
  { name: "TikTok",    slug: "tiktok",    sortOrder: 1 },
  { name: "Instagram", slug: "instagram", sortOrder: 2 },
  { name: "Facebook",  slug: "facebook",  sortOrder: 3 },
  { name: "YouTube",   slug: "youtube",   sortOrder: 4 },
  { name: "Telegram",  slug: "telegram",  sortOrder: 5 },
  { name: "Website",   slug: "website",   sortOrder: 6 },
] as const;

// ---------------------------------------------------------------------------
// Service definitions
// ---------------------------------------------------------------------------

interface ServiceDef {
  platformSlug: string;
  name: string;
  slug: string;
  description: string;
  shortDescription: string;
  targetType: TargetType;
  targetLabel: string;
  targetPlaceholder: string;
  targetHelpText: string;
  fulfillmentType: FulfillmentType;
  sortOrder: number;
  packages: PackageDef[];
}

interface PackageDef {
  name: string;
  description: string;
  quantity: number;
  priceETB: number; // in cents
  deliveryDaysMin: number;
  deliveryDaysMax: number;
  sortOrder: number;
}

const SERVICES: ServiceDef[] = [
  // ─── TikTok ───────────────────────────────────────────────────────────────
  {
    platformSlug: "tiktok",
    name: "TikTok Followers",
    slug: "tiktok-followers",
    description: "Grow your TikTok profile with real-looking followers.",
    shortDescription: "Increase your TikTok follower count.",
    targetType: TargetType.PROFILE,
    targetLabel: "TikTok Profile URL",
    targetPlaceholder: "https://www.tiktok.com/@yourusername",
    targetHelpText: "Enter the full URL of the TikTok profile you want to grow.",
    fulfillmentType: FulfillmentType.MANUAL,
    sortOrder: 1,
    packages: [
      { name: "500 Followers",   description: "500 TikTok followers",   quantity: 500,   priceETB: etb(150),  deliveryDaysMin: 1, deliveryDaysMax: 3,  sortOrder: 1 },
      { name: "1,000 Followers", description: "1,000 TikTok followers", quantity: 1000,  priceETB: etb(270),  deliveryDaysMin: 2, deliveryDaysMax: 5,  sortOrder: 2 },
      { name: "5,000 Followers", description: "5,000 TikTok followers", quantity: 5000,  priceETB: etb(1100), deliveryDaysMin: 3, deliveryDaysMax: 7,  sortOrder: 3 },
    ],
  },
  {
    platformSlug: "tiktok",
    name: "TikTok Post Likes",
    slug: "tiktok-post-likes",
    description: "Boost the likes on a specific TikTok post.",
    shortDescription: "Get more likes on your TikTok post.",
    targetType: TargetType.POST,
    targetLabel: "TikTok Post URL",
    targetPlaceholder: "https://www.tiktok.com/@username/video/1234567890",
    targetHelpText: "Enter the full URL of the TikTok post you want to boost.",
    fulfillmentType: FulfillmentType.MANUAL,
    sortOrder: 2,
    packages: [
      { name: "500 Likes",   description: "500 TikTok post likes",   quantity: 500,  priceETB: etb(100), deliveryDaysMin: 1, deliveryDaysMax: 2, sortOrder: 1 },
      { name: "1,000 Likes", description: "1,000 TikTok post likes", quantity: 1000, priceETB: etb(180), deliveryDaysMin: 1, deliveryDaysMax: 3, sortOrder: 2 },
      { name: "5,000 Likes", description: "5,000 TikTok post likes", quantity: 5000, priceETB: etb(750), deliveryDaysMin: 2, deliveryDaysMax: 5, sortOrder: 3 },
    ],
  },
  {
    platformSlug: "tiktok",
    name: "TikTok Video Views",
    slug: "tiktok-video-views",
    description: "Increase the view count on a TikTok video.",
    shortDescription: "Get more views on your TikTok video.",
    targetType: TargetType.VIDEO,
    targetLabel: "TikTok Video URL",
    targetPlaceholder: "https://www.tiktok.com/@username/video/1234567890",
    targetHelpText: "Enter the full URL of the TikTok video you want more views on.",
    fulfillmentType: FulfillmentType.MANUAL,
    sortOrder: 3,
    packages: [
      { name: "5,000 Views",  description: "5,000 TikTok video views",  quantity: 5000,  priceETB: etb(80),  deliveryDaysMin: 1, deliveryDaysMax: 2, sortOrder: 1 },
      { name: "10,000 Views", description: "10,000 TikTok video views", quantity: 10000, priceETB: etb(140), deliveryDaysMin: 1, deliveryDaysMax: 3, sortOrder: 2 },
      { name: "50,000 Views", description: "50,000 TikTok video views", quantity: 50000, priceETB: etb(550), deliveryDaysMin: 2, deliveryDaysMax: 5, sortOrder: 3 },
    ],
  },

  // ─── Instagram ────────────────────────────────────────────────────────────
  {
    platformSlug: "instagram",
    name: "Instagram Followers",
    slug: "instagram-followers",
    description: "Grow your Instagram profile with followers.",
    shortDescription: "Increase your Instagram follower count.",
    targetType: TargetType.PROFILE,
    targetLabel: "Instagram Profile URL",
    targetPlaceholder: "https://www.instagram.com/yourusername",
    targetHelpText: "Enter the full URL of your Instagram profile.",
    fulfillmentType: FulfillmentType.MANUAL,
    sortOrder: 4,
    packages: [
      { name: "500 Followers",   description: "500 Instagram followers",   quantity: 500,  priceETB: etb(160),  deliveryDaysMin: 1, deliveryDaysMax: 3, sortOrder: 1 },
      { name: "1,000 Followers", description: "1,000 Instagram followers", quantity: 1000, priceETB: etb(290),  deliveryDaysMin: 2, deliveryDaysMax: 5, sortOrder: 2 },
      { name: "5,000 Followers", description: "5,000 Instagram followers", quantity: 5000, priceETB: etb(1200), deliveryDaysMin: 3, deliveryDaysMax: 7, sortOrder: 3 },
    ],
  },
  {
    platformSlug: "instagram",
    name: "Instagram Post Likes",
    slug: "instagram-post-likes",
    description: "Boost likes on a specific Instagram post.",
    shortDescription: "Get more likes on your Instagram post.",
    targetType: TargetType.POST,
    targetLabel: "Instagram Post URL",
    targetPlaceholder: "https://www.instagram.com/p/ABC123/",
    targetHelpText: "Enter the full URL of the Instagram post you want to boost.",
    fulfillmentType: FulfillmentType.MANUAL,
    sortOrder: 5,
    packages: [
      { name: "500 Likes",   description: "500 Instagram post likes",   quantity: 500,  priceETB: etb(110), deliveryDaysMin: 1, deliveryDaysMax: 2, sortOrder: 1 },
      { name: "1,000 Likes", description: "1,000 Instagram post likes", quantity: 1000, priceETB: etb(200), deliveryDaysMin: 1, deliveryDaysMax: 3, sortOrder: 2 },
      { name: "5,000 Likes", description: "5,000 Instagram post likes", quantity: 5000, priceETB: etb(800), deliveryDaysMin: 2, deliveryDaysMax: 5, sortOrder: 3 },
    ],
  },
  {
    platformSlug: "instagram",
    name: "Instagram Post Views",
    slug: "instagram-post-views",
    description: "Increase the view count on an Instagram video or reel.",
    shortDescription: "Get more views on your Instagram post.",
    targetType: TargetType.POST,
    targetLabel: "Instagram Post URL",
    targetPlaceholder: "https://www.instagram.com/p/ABC123/",
    targetHelpText: "Enter the full URL of the Instagram video or reel you want more views on.",
    fulfillmentType: FulfillmentType.MANUAL,
    sortOrder: 6,
    packages: [
      { name: "5,000 Views",  description: "5,000 Instagram post views",  quantity: 5000,  priceETB: etb(90),  deliveryDaysMin: 1, deliveryDaysMax: 2, sortOrder: 1 },
      { name: "10,000 Views", description: "10,000 Instagram post views", quantity: 10000, priceETB: etb(160), deliveryDaysMin: 1, deliveryDaysMax: 3, sortOrder: 2 },
      { name: "50,000 Views", description: "50,000 Instagram post views", quantity: 50000, priceETB: etb(600), deliveryDaysMin: 2, deliveryDaysMax: 5, sortOrder: 3 },
    ],
  },

  // ─── Facebook ─────────────────────────────────────────────────────────────
  {
    platformSlug: "facebook",
    name: "Facebook Page Followers",
    slug: "facebook-page-followers",
    description: "Grow your Facebook Page with more followers.",
    shortDescription: "Increase your Facebook Page follower count.",
    targetType: TargetType.PAGE,
    targetLabel: "Facebook Page URL",
    targetPlaceholder: "https://www.facebook.com/yourpagename",
    targetHelpText: "Enter the full URL of your Facebook Page (not a personal profile).",
    fulfillmentType: FulfillmentType.MANUAL,
    sortOrder: 7,
    packages: [
      { name: "500 Followers",   description: "500 Facebook page followers",   quantity: 500,  priceETB: etb(170),  deliveryDaysMin: 2, deliveryDaysMax: 5, sortOrder: 1 },
      { name: "1,000 Followers", description: "1,000 Facebook page followers", quantity: 1000, priceETB: etb(310),  deliveryDaysMin: 3, deliveryDaysMax: 6, sortOrder: 2 },
      { name: "5,000 Followers", description: "5,000 Facebook page followers", quantity: 5000, priceETB: etb(1300), deliveryDaysMin: 5, deliveryDaysMax: 10, sortOrder: 3 },
    ],
  },
  {
    platformSlug: "facebook",
    name: "Facebook Post Likes",
    slug: "facebook-post-likes",
    description: "Boost likes on a specific Facebook post.",
    shortDescription: "Get more likes on your Facebook post.",
    targetType: TargetType.POST,
    targetLabel: "Facebook Post URL",
    targetPlaceholder: "https://www.facebook.com/yourpage/posts/1234567890",
    targetHelpText: "Enter the full URL of the Facebook post you want to boost.",
    fulfillmentType: FulfillmentType.MANUAL,
    sortOrder: 8,
    packages: [
      { name: "500 Likes",   description: "500 Facebook post likes",   quantity: 500,  priceETB: etb(120), deliveryDaysMin: 1, deliveryDaysMax: 3, sortOrder: 1 },
      { name: "1,000 Likes", description: "1,000 Facebook post likes", quantity: 1000, priceETB: etb(220), deliveryDaysMin: 2, deliveryDaysMax: 4, sortOrder: 2 },
      { name: "5,000 Likes", description: "5,000 Facebook post likes", quantity: 5000, priceETB: etb(850), deliveryDaysMin: 3, deliveryDaysMax: 6, sortOrder: 3 },
    ],
  },

  // ─── YouTube ──────────────────────────────────────────────────────────────
  {
    platformSlug: "youtube",
    name: "YouTube Subscribers",
    slug: "youtube-subscribers",
    description: "Grow your YouTube channel with more subscribers.",
    shortDescription: "Increase your YouTube subscriber count.",
    targetType: TargetType.CHANNEL,
    targetLabel: "YouTube Channel URL",
    targetPlaceholder: "https://www.youtube.com/@yourchannel",
    targetHelpText: "Enter the full URL of your YouTube channel.",
    fulfillmentType: FulfillmentType.MANUAL,
    sortOrder: 9,
    packages: [
      { name: "500 Subscribers",   description: "500 YouTube subscribers",   quantity: 500,  priceETB: etb(200),  deliveryDaysMin: 3, deliveryDaysMax: 7,  sortOrder: 1 },
      { name: "1,000 Subscribers", description: "1,000 YouTube subscribers", quantity: 1000, priceETB: etb(370),  deliveryDaysMin: 5, deliveryDaysMax: 10, sortOrder: 2 },
      { name: "5,000 Subscribers", description: "5,000 YouTube subscribers", quantity: 5000, priceETB: etb(1500), deliveryDaysMin: 7, deliveryDaysMax: 14, sortOrder: 3 },
    ],
  },
  {
    platformSlug: "youtube",
    name: "YouTube Video Views",
    slug: "youtube-video-views",
    description: "Increase the view count on a YouTube video.",
    shortDescription: "Get more views on your YouTube video.",
    targetType: TargetType.VIDEO,
    targetLabel: "YouTube Video URL",
    targetPlaceholder: "https://www.youtube.com/watch?v=VIDEOID",
    targetHelpText: "Enter the full URL of the YouTube video you want more views on.",
    fulfillmentType: FulfillmentType.MANUAL,
    sortOrder: 10,
    packages: [
      { name: "5,000 Views",  description: "5,000 YouTube video views",  quantity: 5000,  priceETB: etb(120), deliveryDaysMin: 2, deliveryDaysMax: 5,  sortOrder: 1 },
      { name: "10,000 Views", description: "10,000 YouTube video views", quantity: 10000, priceETB: etb(210), deliveryDaysMin: 3, deliveryDaysMax: 7,  sortOrder: 2 },
      { name: "50,000 Views", description: "50,000 YouTube video views", quantity: 50000, priceETB: etb(800), deliveryDaysMin: 5, deliveryDaysMax: 10, sortOrder: 3 },
    ],
  },

  // ─── Telegram ─────────────────────────────────────────────────────────────
  {
    platformSlug: "telegram",
    name: "Telegram Channel Members",
    slug: "telegram-channel-members",
    description: "Grow your Telegram channel with more members.",
    shortDescription: "Increase your Telegram channel member count.",
    targetType: TargetType.CHANNEL,
    targetLabel: "Telegram Channel Link",
    targetPlaceholder: "https://t.me/yourchannel",
    targetHelpText: "Enter your Telegram channel invite link (t.me/...).",
    fulfillmentType: FulfillmentType.MANUAL,
    sortOrder: 11,
    packages: [
      { name: "500 Members",   description: "500 Telegram channel members",   quantity: 500,  priceETB: etb(130),  deliveryDaysMin: 1, deliveryDaysMax: 3, sortOrder: 1 },
      { name: "1,000 Members", description: "1,000 Telegram channel members", quantity: 1000, priceETB: etb(240),  deliveryDaysMin: 2, deliveryDaysMax: 5, sortOrder: 2 },
      { name: "5,000 Members", description: "5,000 Telegram channel members", quantity: 5000, priceETB: etb(1000), deliveryDaysMin: 3, deliveryDaysMax: 7, sortOrder: 3 },
    ],
  },
  {
    platformSlug: "telegram",
    name: "Telegram Post Views",
    slug: "telegram-post-views",
    description: "Increase the view count on a Telegram channel post.",
    shortDescription: "Get more views on your Telegram post.",
    targetType: TargetType.POST,
    targetLabel: "Telegram Post Link",
    targetPlaceholder: "https://t.me/yourchannel/123",
    targetHelpText: "Enter the full link to the specific Telegram post (t.me/channel/postnumber).",
    fulfillmentType: FulfillmentType.MANUAL,
    sortOrder: 12,
    packages: [
      { name: "5,000 Views",  description: "5,000 Telegram post views",  quantity: 5000,  priceETB: etb(70),  deliveryDaysMin: 1, deliveryDaysMax: 2, sortOrder: 1 },
      { name: "10,000 Views", description: "10,000 Telegram post views", quantity: 10000, priceETB: etb(120), deliveryDaysMin: 1, deliveryDaysMax: 3, sortOrder: 2 },
      { name: "50,000 Views", description: "50,000 Telegram post views", quantity: 50000, priceETB: etb(450), deliveryDaysMin: 2, deliveryDaysMax: 4, sortOrder: 3 },
    ],
  },

  // ─── Website ──────────────────────────────────────────────────────────────
  {
    platformSlug: "website",
    name: "Website Traffic",
    slug: "website-traffic",
    description: "Drive real visitors to your website.",
    shortDescription: "Increase your website visitor traffic.",
    targetType: TargetType.WEBSITE,
    targetLabel: "Website URL",
    targetPlaceholder: "https://www.yourwebsite.com",
    targetHelpText: "Enter the full URL of the website you want to drive traffic to.",
    fulfillmentType: FulfillmentType.MANUAL,
    sortOrder: 13,
    packages: [
      { name: "1,000 Visitors",  description: "1,000 website visitors",  quantity: 1000,  priceETB: etb(180), deliveryDaysMin: 3, deliveryDaysMax: 7,  sortOrder: 1 },
      { name: "5,000 Visitors",  description: "5,000 website visitors",  quantity: 5000,  priceETB: etb(750), deliveryDaysMin: 5, deliveryDaysMax: 10, sortOrder: 2 },
      { name: "10,000 Visitors", description: "10,000 website visitors", quantity: 10000, priceETB: etb(1400), deliveryDaysMin: 7, deliveryDaysMax: 14, sortOrder: 3 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Payment methods
// ---------------------------------------------------------------------------

const PAYMENT_METHODS = [
  {
    name: "CBE (Commercial Bank of Ethiopia)",
    description: "Pay via Commercial Bank of Ethiopia bank transfer.",
    accountName: "Connect Digitals",
    accountNumber: "1000123456789",
    bankName: "Commercial Bank of Ethiopia",
    instructions:
      "1. Open your CBE mobile app or visit any CBE branch.\n2. Transfer the exact amount to the account above.\n3. Take a screenshot of the confirmation.\n4. Enter the transaction reference number below and upload the screenshot.",
    sortOrder: 1,
  },
  {
    name: "Awash Bank",
    description: "Pay via Awash Bank transfer.",
    accountName: "Connect Digitals",
    accountNumber: "0123456789012",
    bankName: "Awash Bank",
    instructions:
      "1. Open your Awash Bank mobile app or visit a branch.\n2. Transfer the exact amount to the account above.\n3. Take a screenshot of the confirmation.\n4. Enter the transaction reference number below and upload the screenshot.",
    sortOrder: 2,
  },
  {
    name: "Telebirr",
    description: "Pay via Telebirr mobile money.",
    accountName: "Connect Digitals",
    accountNumber: "0911000000",
    bankName: null,
    instructions:
      "1. Open your Telebirr app.\n2. Send the exact amount to the number above.\n3. Take a screenshot of the confirmation.\n4. Enter the transaction reference number below and upload the screenshot.",
    sortOrder: 3,
  },
] as const;

// ---------------------------------------------------------------------------
// Main seed function
// ---------------------------------------------------------------------------

async function main() {
  console.log("🌱  Starting seed...\n");

  // ── Platforms ──────────────────────────────────────────────────────────────
  console.log("  Seeding platforms...");
  const platformMap: Record<string, string> = {}; // slug → id

  for (const p of PLATFORMS) {
    const platform = await prisma.platform.upsert({
      where: { slug: p.slug },
      update: {
        name: p.name,
        sortOrder: p.sortOrder,
      },
      create: {
        name: p.name,
        slug: p.slug,
        sortOrder: p.sortOrder,
        isActive: true,
      },
    });
    platformMap[p.slug] = platform.id;
    console.log(`    ✓  Platform: ${platform.name}`);
  }

  // ── Services & Packages ───────────────────────────────────────────────────
  console.log("\n  Seeding services and packages...");

  for (const svc of SERVICES) {
    const platformId = platformMap[svc.platformSlug];
    if (!platformId) {
      throw new Error(`Platform not found for slug: ${svc.platformSlug}`);
    }

    const service = await prisma.promotionService.upsert({
      where: { slug: svc.slug },
      update: {
        name: svc.name,
        description: svc.description,
        shortDescription: svc.shortDescription,
        targetType: svc.targetType,
        targetLabel: svc.targetLabel,
        targetPlaceholder: svc.targetPlaceholder,
        targetHelpText: svc.targetHelpText,
        fulfillmentType: svc.fulfillmentType,
        sortOrder: svc.sortOrder,
      },
      create: {
        platformId,
        name: svc.name,
        slug: svc.slug,
        description: svc.description,
        shortDescription: svc.shortDescription,
        targetType: svc.targetType,
        targetLabel: svc.targetLabel,
        targetPlaceholder: svc.targetPlaceholder,
        targetHelpText: svc.targetHelpText,
        requiresTargetUrl: true,
        fulfillmentType: svc.fulfillmentType,
        requiresHumanApproval: false,
        isActive: true,
        sortOrder: svc.sortOrder,
      },
    });

    console.log(`    ✓  Service: ${service.name}`);

    for (const pkg of svc.packages) {
      await prisma.servicePackage.upsert({
        where: {
          // Unique by service + name combo — use a generated slug approach via findFirst + upsert by id
          // Prisma requires a unique field for upsert; we use serviceId+name via a raw approach
          id: (
            await prisma.servicePackage.findFirst({
              where: { serviceId: service.id, name: pkg.name },
              select: { id: true },
            })
          )?.id ?? "create-new",
        },
        update: {
          description: pkg.description,
          quantity: pkg.quantity,
          priceETB: pkg.priceETB,
          deliveryDaysMin: pkg.deliveryDaysMin,
          deliveryDaysMax: pkg.deliveryDaysMax,
          sortOrder: pkg.sortOrder,
        },
        create: {
          serviceId: service.id,
          name: pkg.name,
          description: pkg.description,
          quantity: pkg.quantity,
          priceETB: pkg.priceETB,
          deliveryDaysMin: pkg.deliveryDaysMin,
          deliveryDaysMax: pkg.deliveryDaysMax,
          isActive: true,
          sortOrder: pkg.sortOrder,
        },
      });
      console.log(`       ✓  Package: ${pkg.name} (${pkg.priceETB / 100} ETB)`);
    }
  }

  // ── Payment methods ────────────────────────────────────────────────────────
  console.log("\n  Seeding payment methods...");

  for (const pm of PAYMENT_METHODS) {
    const existing = await prisma.paymentMethod.findFirst({
      where: { name: pm.name },
    });

    if (existing) {
      await prisma.paymentMethod.update({
        where: { id: existing.id },
        data: {
          description: pm.description,
          accountName: pm.accountName,
          accountNumber: pm.accountNumber,
          bankName: pm.bankName ?? null,
          instructions: pm.instructions,
          sortOrder: pm.sortOrder,
        },
      });
    } else {
      await prisma.paymentMethod.create({
        data: {
          name: pm.name,
          description: pm.description,
          accountName: pm.accountName,
          accountNumber: pm.accountNumber,
          bankName: pm.bankName ?? null,
          instructions: pm.instructions,
          isActive: true,
          sortOrder: pm.sortOrder,
        },
      });
    }
    console.log(`    ✓  Payment method: ${pm.name}`);
  }

  // ── Bootstrap SUPER_ADMIN ──────────────────────────────────────────────────
  // NOTE: After Supabase Auth migration, the admin account must also be created
  // in Supabase Auth (Dashboard → Authentication → Users) with the same email.
  // The AdminUser table stores the role; Supabase Auth handles the password.
  const adminEmail = process.env["ADMIN_BOOTSTRAP_EMAIL"];

  if (adminEmail) {
    console.log("\n  Seeding bootstrap admin...");

    const existing = await prisma.adminUser.findUnique({
      where: { email: adminEmail },
    });

    if (!existing) {
      await prisma.adminUser.create({
        data: {
          email: adminEmail,
          firstName: "Super",
          lastName: "Admin",
          role: "SUPER_ADMIN",
          isActive: true,
        },
      });
      console.log(`    ✓  Admin record created: ${adminEmail}`);
      console.log(`    ⚠️   Remember to create the Supabase Auth user with this email in the Supabase Dashboard.`);
    } else {
      console.log(`    –  Admin already exists: ${adminEmail} (skipped)`);
    }
  } else {
    console.log(
      "\n  ⚠️   ADMIN_BOOTSTRAP_EMAIL not set — skipping admin seed."
    );
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const [platformCount, serviceCount, packageCount, pmCount, adminCount] =
    await Promise.all([
      prisma.platform.count(),
      prisma.promotionService.count(),
      prisma.servicePackage.count(),
      prisma.paymentMethod.count(),
      prisma.adminUser.count(),
    ]);

  console.log("\n✅  Seed complete:");
  console.log(`    Platforms:       ${platformCount}`);
  console.log(`    Services:        ${serviceCount}`);
  console.log(`    Packages:        ${packageCount}`);
  console.log(`    Payment methods: ${pmCount}`);
  console.log(`    Admin users:     ${adminCount}`);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main()
  .catch((err) => {
    console.error("❌  Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
