import { networkInterfaces } from 'os';

/**
 * Detect the primary non-loopback IPv4 address of this host.
 * Returns the first address found, or '127.0.0.1' if none detected.
 */
export function detectPrimaryIp(): string {
  const interfaces = networkInterfaces();
  for (const name in interfaces) {
    const nets = interfaces[name];
    if (!nets) continue;
    for (const net of nets) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}
