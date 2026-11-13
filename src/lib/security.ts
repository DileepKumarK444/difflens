/**
 * Request guards for a localhost-only app. Pure functions so they can be unit tested;
 * src/proxy.ts applies them to every request.
 */

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);
export const CSRF_COOKIE = "difflens_csrf";
export const CSRF_HEADER = "x-csrf-token";
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function hostnameOf(hostHeader: string | null): string | null {
  if (!hostHeader) return null;
  if (hostHeader.startsWith("[")) {
    const end = hostHeader.indexOf("]");
    return end === -1 ? null : hostHeader.slice(0, end + 1).toLowerCase();
  }
  return hostHeader.split(":")[0].toLowerCase();
}

/** Blocks DNS-rebinding: the Host header must name a loopback address. */
export function isAllowedHost(hostHeader: string | null): boolean {
  const name = hostnameOf(hostHeader);
  return name !== null && LOCAL_HOSTNAMES.has(name);
}

export function isMutating(method: string): boolean {
  return MUTATING.has(method.toUpperCase());
}

/**
 * Same-origin check. Mutating requests must carry an Origin that matches Host.
 * Other requests may omit Origin (plain navigation) but must match if present.
 */
export function isAllowedOrigin(method: string, origin: string | null, hostHeader: string | null): boolean {
  if (origin === null) return !isMutating(method);
  try {
    const u = new URL(origin);
    return (u.protocol === "http:" || u.protocol === "https:") && u.host === hostHeader;
  } catch {
    return false;
  }
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Double-submit token: header must equal the cookie. */
export function isValidCsrf(method: string, cookie: string | undefined, header: string | null): boolean {
  if (!isMutating(method)) return true;
  if (!cookie || cookie.length < 32 || !header) return false;
  return timingSafeEqualStr(cookie, header);
}

export function newCsrfToken(): string {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
}
