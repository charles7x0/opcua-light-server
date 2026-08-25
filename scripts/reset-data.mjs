/**
 * Reset runtime data — removes database, certificates, PKI store, and config.
 * Cross-platform (works on Windows, Linux, macOS).
 *
 * Usage: node scripts/reset-data.mjs
 */

import { rmSync, existsSync } from 'fs';
import { resolve } from 'path';

const targets = [
  'data',
  'runtime/opcua-light.db',
  'runtime/config.json',
];

console.log('Resetting runtime data...');

for (const target of targets) {
  const fullPath = resolve(target);
  if (existsSync(fullPath)) {
    rmSync(fullPath, { recursive: true, force: true });
    console.log(`  Removed: ${target}`);
  }
}

console.log('Done. Start the server to recreate a fresh database.');
