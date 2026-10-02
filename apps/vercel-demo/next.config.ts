import { resolve } from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  // The app lives in a monorepo; trace dependencies from the repository root.
  outputFileTracingRoot: resolve(process.cwd(), '../..'),
};

export default config;
