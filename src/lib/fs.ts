import { mkdir } from 'fs/promises';

export async function ensureDirectory(path: string) {
  await mkdir(path, { recursive: true });
}
