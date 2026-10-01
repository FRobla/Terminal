import type { CookieSerializeOptions } from "@fastify/cookie";

/**
 * `__Host-` cookies require `Secure`, which browsers only honor over HTTPS; local
 * HTTP development uses an unprefixed, non-Secure cookie (SECURITY.md §5).
 */
export function sessionCookieSettings(publicAppOrigin: string): {
  name: string;
  options: CookieSerializeOptions;
} {
  const secure = new URL(publicAppOrigin).protocol === "https:";
  return {
    name: secure ? "__Host-sct_session" : "sct_session",
    options: { httpOnly: true, secure, sameSite: "strict", path: "/" },
  };
}
