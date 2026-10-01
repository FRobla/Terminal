import type { Permission, RouteCatalogEntry } from "@sct/validation";

export type DeclaredAccess = { public: true } | { session: true } | { permission: Permission };

/** Every registered route with its declared access requirement (OWN-AC-16). Filled while routes register. */
export class RouteCatalog {
  private readonly entries: RouteCatalogEntry[] = [];

  record(methods: string | readonly string[], url: string, access: DeclaredAccess | undefined): void {
    if (!access) return;
    const list = typeof methods === "string" ? [methods] : methods;
    for (const method of list) {
      // Fastify adds HEAD for every GET; listing it twice adds no information.
      if (method === "HEAD") continue;
      this.entries.push({
        method,
        url,
        access:
          "permission" in access
            ? { kind: "permission", permission: access.permission }
            : "session" in access
              ? { kind: "session" }
              : { kind: "public" },
      });
    }
  }

  list(): RouteCatalogEntry[] {
    return [...this.entries].sort((a, b) => a.url.localeCompare(b.url) || a.method.localeCompare(b.method));
  }
}
