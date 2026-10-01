import type { FastifyRequest } from "fastify";

/** Standard success envelope (API.md §1). */
export function envelope<T>(request: FastifyRequest, data: T, meta: { nextCursor?: string | null } = {}) {
  return {
    data,
    meta: { requestId: request.id, generatedAt: new Date().toISOString(), ...meta },
  };
}
