import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

export async function configureSqlite(prismaClient: PrismaClient) {
  await prismaClient.$queryRawUnsafe('PRAGMA journal_mode = WAL');
  await prismaClient.$queryRawUnsafe('PRAGMA busy_timeout = 5000');
  await prismaClient.$queryRawUnsafe('PRAGMA foreign_keys = ON');
}
