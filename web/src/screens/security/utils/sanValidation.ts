const DNS_REGEX = /^[a-zA-Z0-9.-]+$/;
const MAX_DNS_LENGTH = 253;

export const MAX_SAN_ENTRIES = 20;

export function isValidDnsName(dns: string): boolean {
  const trimmed = dns.trim();
  if (!trimmed || trimmed.length > MAX_DNS_LENGTH) return false;
  return DNS_REGEX.test(trimmed);
}

export function isValidIpv4(ip: string): boolean {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    const num = Number(part);
    return /^\d{1,3}$/.test(part) && num >= 0 && num <= 255;
  });
}

export function isValidIpv6(ip: string): boolean {
  const trimmed = ip.trim();
  if (!trimmed.includes(':')) return false;
  const parts = trimmed.split(':');
  if (parts.length < 2 || parts.length > 8) return false;
  const hasDoubleColon = trimmed.includes('::');
  if (hasDoubleColon && (trimmed.match(/::/g) || []).length > 1) return false;
  return parts.every((part) => part === '' || /^[0-9a-fA-F]{1,4}$/.test(part));
}

export function isValidIpAddress(ip: string): boolean {
  return isValidIpv4(ip) || isValidIpv6(ip);
}

export function parseMultiInput(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
