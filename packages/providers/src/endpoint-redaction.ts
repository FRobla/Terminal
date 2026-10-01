const KEY_LIKE_SEGMENT = /^[A-Za-z0-9_-]{24,}$/;

/**
 * Removes credentials from a provider endpoint before it is logged, stored, or
 * returned in provenance (PRV-AC-05): user info, the whole query string, and any
 * path segment that looks like an API key.
 */
export function redactEndpoint(endpoint: string): string {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return "[invalid endpoint]";
  }
  const path = url.pathname
    .split("/")
    .map((segment) => (KEY_LIKE_SEGMENT.test(segment) ? "[REDACTED]" : segment))
    .join("/");
  return `${url.protocol}//${url.host}${path === "/" ? "" : path}`;
}
