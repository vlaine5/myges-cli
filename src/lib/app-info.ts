import { readFileSync } from 'fs';
import path from 'path';

const packageJson = JSON.parse(
  readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'),
) as { version?: string };

export const appInfo = {
  version: packageJson.version ?? '0.0.0',
};
