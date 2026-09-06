import { env } from "../config/env.js";
import { prisma } from "./client.js";

async function main(): Promise<void> {
  const user = await prisma.user.upsert({
    where: { googleId: env.SEED_DEMO_GOOGLE_ID },
    update: {
      email: env.SEED_DEMO_EMAIL,
      name: env.SEED_DEMO_NAME,
    },
    create: {
      googleId: env.SEED_DEMO_GOOGLE_ID,
      email: env.SEED_DEMO_EMAIL,
      name: env.SEED_DEMO_NAME,
    },
  });

  const demoSenders = [
    { email: "sender-a@ethereal.email", displayName: "Demo Sender A" },
    { email: "sender-b@ethereal.email", displayName: "Demo Sender B" },
  ];

  for (const sender of demoSenders) {
    await prisma.sender.upsert({
      where: {
        userId_email: {
          userId: user.id,
          email: sender.email,
        },
      },
      update: sender,
      create: {
        userId: user.id,
        ...sender,
      },
    });
  }

  console.info(`Seeded demo user ${user.email} and ${demoSenders.length} sender records.`);
}

main()
  .catch((error: unknown) => {
    console.error("Database seed failed.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
