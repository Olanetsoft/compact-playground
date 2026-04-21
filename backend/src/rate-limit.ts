import { getConfig } from "./config.js";
import type { Context } from "hono";

// Hard cap on distinct buckets per map. Protects against adversarial inputs
// (e.g. rotating X-Client-ID per request) that would otherwise grow the map
// until the 5-minute sweep runs. When full, oldest entries are evicted first.
const MAX_RATE_LIMIT_ENTRIES = 10_000;

// X-Client-ID must be a short opaque token. Reject oversized or non-opaque
// values so a hostile client can't explode the bucket space with unique keys.
const CLIENT_ID_MAX_LENGTH = 128;
const CLIENT_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

// Sweep expired entries every 5 minutes to prevent unbounded growth
setInterval(
  () => {
    const now = Date.now();
    for (const [ip, record] of rateLimitMap) {
      if (now > record.resetTime) {
        rateLimitMap.delete(ip);
      }
    }
  },
  5 * 60 * 1000,
).unref();

const archiveRateLimitMap = new Map<string, { count: number; resetTime: number }>();

// Sweep expired archive rate-limit entries every 5 minutes
setInterval(
  () => {
    const now = Date.now();
    for (const [ip, record] of archiveRateLimitMap) {
      if (now > record.resetTime) {
        archiveRateLimitMap.delete(ip);
      }
    }
  },
  5 * 60 * 1000,
).unref();

function evictOldestIfFull<V>(map: Map<string, V>, cap: number): void {
  while (map.size >= cap) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

function isValidClientId(value: string): boolean {
  return value.length <= CLIENT_ID_MAX_LENGTH && CLIENT_ID_PATTERN.test(value);
}

export function checkRateLimit(ip: string): boolean {
  const config = getConfig();
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || now > record.resetTime) {
    evictOldestIfFull(rateLimitMap, MAX_RATE_LIMIT_ENTRIES);
    rateLimitMap.set(ip, { count: 1, resetTime: now + config.rateWindow });
    return true;
  }

  if (record.count >= config.rateLimit) {
    return false;
  }

  record.count++;
  return true;
}

export function checkArchiveRateLimit(ip: string): boolean {
  const config = getConfig();
  const now = Date.now();
  const record = archiveRateLimitMap.get(ip);

  if (!record || now > record.resetTime) {
    evictOldestIfFull(archiveRateLimitMap, MAX_RATE_LIMIT_ENTRIES);
    archiveRateLimitMap.set(ip, { count: 1, resetTime: now + config.archiveRateWindow });
    return true;
  }

  if (record.count >= config.archiveRateLimit) {
    return false;
  }

  record.count++;
  return true;
}

/**
 * Best-effort extraction of the runtime-provided client IP from the
 * server/platform context. With @hono/node-server this is available
 * via c.env.incoming.socket.remoteAddress. Other adapters may differ,
 * so this is defensive and returns null when unavailable.
 */
function getRuntimeIp(c: Context): string | null {
  const addr = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)
    ?.incoming?.socket?.remoteAddress;

  if (typeof addr === "string" && addr.trim()) {
    return addr.trim();
  }

  return null;
}

/**
 * Extracts a client identity for rate limiting.
 *
 * Precedence:
 * 1. X-Client-ID header (opaque per-instance ID sent by MCP/API clients)
 * 2. TRUST_CLOUDFLARE=true → CF-Connecting-IP (set by Cloudflare, not spoofable)
 * 3. TRUST_PROXY=true → x-forwarded-for / x-real-ip (only safe behind a trusted reverse proxy)
 * 4. Runtime/platform-provided client IP (e.g. Node socket remoteAddress)
 * 5. "unknown" (safe final fallback)
 */
export function getClientIp(c: Context): string {
  // X-Client-ID allows proxied clients (e.g. MCP servers) to get
  // per-instance rate limit buckets instead of sharing one IP bucket.
  // Invalid values (oversized, non-opaque charset) silently fall through
  // to IP-based identification rather than 400-ing legitimate clients.
  const clientId = c.req.header("x-client-id")?.trim();
  if (clientId && isValidClientId(clientId)) return `client:${clientId}`;

  const config = getConfig();

  if (config.trustCloudflare) {
    const cfIp = c.req.header("cf-connecting-ip");
    if (cfIp) return cfIp.trim();
  }

  if (config.trustProxy) {
    const xff = c.req.header("x-forwarded-for");
    if (xff) return xff.split(",")[0].trim();

    const realIp = c.req.header("x-real-ip");
    if (realIp) return realIp.trim();
  }

  const runtimeIp = getRuntimeIp(c);
  if (runtimeIp) return runtimeIp;

  return "unknown";
}
