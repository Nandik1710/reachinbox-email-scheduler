import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient({
  log: ["warn", "error"],
});

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
