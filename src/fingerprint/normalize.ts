const ENV_PREFIXES = ['dev.', 'prod.', 'stg.', 'staging.', 'qa.', 'test.'];
const VERSION_SUFFIX = /\.v\d+$/i;

export function normalizeKafkaTopic(raw: string): string {
  let s = raw.trim().toLowerCase();
  for (const prefix of ENV_PREFIXES) {
    if (s.startsWith(prefix)) {
      s = s.slice(prefix.length);
      break;
    }
  }
  s = s.replace(VERSION_SUFFIX, '');
  return s;
}

export function normalizeRestPath(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(\w+)\s+(.+)$/);
  if (!match) return trimmed;

  const method = match[1].toUpperCase();
  let routePath = match[2];
  if (routePath.length > 1 && routePath.endsWith('/')) {
    routePath = routePath.slice(0, -1);
  }
  routePath = routePath.replace(/\{[^}]+\}/g, ':param');
  routePath = routePath.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ':param');
  return `${method} ${routePath}`;
}

export function normalizeIdentifier(
  type: string,
  identifier: string
): string {
  if (type === 'kafka-topic') return normalizeKafkaTopic(identifier);
  if (type === 'rest-endpoint') return normalizeRestPath(identifier);
  return identifier.trim().toLowerCase();
}
