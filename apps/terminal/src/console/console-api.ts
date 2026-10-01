"use client";

import {
  adminOrganizationSchema,
  adminOverviewSchema,
  adminSessionSummarySchema,
  adminUserSchema,
  auditEventSchema,
  cachePurgeResponseSchema,
  enqueuedJobSchema,
  jobsOverviewSchema,
  networkIdentitySchema,
  providerHealthSnapshotSchema,
  roleMatrixSchema,
  routeCatalogSchema,
  runtimeInspectionSchema,
  sessionRevocationResponseSchema,
  type AssignableRoleKey,
} from "@sct/validation";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { SESSION_QUERY_KEY, useSession } from "../auth/use-session";
import { apiRequest, apiRequestWithMeta } from "../platform/api-client";

/** SPEC-026 — owner console data. Every query key starts with "admin" so sign-out drops them all. */

function useOwnerEnabled(): boolean {
  const { session, can } = useSession();
  return session !== null && can("platform.administer");
}

function useCsrfToken(): string | undefined {
  return useSession().session?.csrfToken;
}

export function useAdminOverview() {
  return useQuery({
    queryKey: ["admin", "overview"],
    queryFn: ({ signal }) => apiRequest("/admin/overview", adminOverviewSchema, { signal }),
    enabled: useOwnerEnabled(),
    refetchInterval: 30_000,
  });
}

const USERS_PAGE_SIZE = 50;

export function useAdminUsers() {
  return useInfiniteQuery({
    queryKey: ["admin", "users"],
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) =>
      apiRequestWithMeta(
        `/admin/users?limit=${USERS_PAGE_SIZE}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`,
        z.array(adminUserSchema),
        { signal },
      ),
    getNextPageParam: (page) => page.meta.nextCursor ?? null,
    enabled: useOwnerEnabled(),
  });
}

type MemberAction =
  | { kind: "role"; userId: string; roleKey: AssignableRoleKey }
  | { kind: "membership"; userId: string; status: "active" | "suspended" }
  | { kind: "status"; userId: string; status: "active" | "disabled" }
  | { kind: "revoke-sessions"; userId: string };

export function useMemberAction() {
  const queryClient = useQueryClient();
  const csrfToken = useCsrfToken();
  return useMutation({
    mutationFn: async (action: MemberAction) => {
      const base = `/admin/users/${encodeURIComponent(action.userId)}`;
      switch (action.kind) {
        case "role":
          return apiRequest(`${base}/role`, adminUserSchema, {
            method: "PUT",
            body: { roleKey: action.roleKey },
            csrfToken,
          });
        case "membership":
          return apiRequest(`${base}/membership`, adminUserSchema, {
            method: "PUT",
            body: { status: action.status },
            csrfToken,
          });
        case "status":
          return apiRequest(`${base}/status`, adminUserSchema, {
            method: "PUT",
            body: { status: action.status },
            csrfToken,
          });
        case "revoke-sessions":
          return apiRequest(`${base}/sessions/revoke`, sessionRevocationResponseSchema, {
            method: "POST",
            csrfToken,
          });
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["admin"] }),
  });
}

export function useAdminSessions() {
  return useQuery({
    queryKey: ["admin", "sessions"],
    queryFn: ({ signal }) => apiRequest("/admin/sessions", z.array(adminSessionSummarySchema), { signal }),
    enabled: useOwnerEnabled(),
    refetchInterval: 60_000,
  });
}

export function useRevokeAnySession() {
  const queryClient = useQueryClient();
  const csrfToken = useCsrfToken();
  return useMutation({
    mutationFn: (sessionId: string) =>
      apiRequest(`/admin/sessions/${encodeURIComponent(sessionId)}/revoke`, sessionRevocationResponseSchema, {
        method: "POST",
        csrfToken,
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["admin"] }),
  });
}

export interface AuditFilters {
  action: string;
  actorId: string;
  resourceType: string;
  from: string;
  to: string;
}

export function useAuditEvents(filters: AuditFilters) {
  return useInfiniteQuery({
    queryKey: ["admin", "audit", filters],
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) => {
      const query = new URLSearchParams({ limit: "50" });
      if (pageParam) query.set("cursor", pageParam);
      if (filters.action) query.set("action", filters.action);
      if (filters.actorId) query.set("actorId", filters.actorId);
      if (filters.resourceType) query.set("resourceType", filters.resourceType);
      if (filters.from) query.set("from", filters.from);
      if (filters.to) query.set("to", filters.to);
      return apiRequestWithMeta(`/audit/events?${query.toString()}`, z.array(auditEventSchema), { signal });
    },
    getNextPageParam: (page) => page.meta.nextCursor ?? null,
    enabled: useOwnerEnabled(),
  });
}

export function useAdminOrganization() {
  return useQuery({
    queryKey: ["admin", "organization"],
    queryFn: ({ signal }) => apiRequest("/admin/organization", adminOrganizationSchema, { signal }),
    enabled: useOwnerEnabled(),
  });
}

export function useRenameOrganization() {
  const queryClient = useQueryClient();
  const csrfToken = useCsrfToken();
  return useMutation({
    mutationFn: (name: string) =>
      apiRequest("/admin/organization", adminOrganizationSchema, {
        method: "PATCH",
        body: { name },
        csrfToken,
      }),
    onSuccess: async (organization) => {
      queryClient.setQueryData(["admin", "organization"], organization);
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    },
  });
}

export function useRoleMatrix() {
  return useQuery({
    queryKey: ["admin", "roles"],
    queryFn: ({ signal }) => apiRequest("/admin/roles", roleMatrixSchema, { signal }),
    enabled: useOwnerEnabled(),
  });
}

export function useRuntimeInspection() {
  return useQuery({
    queryKey: ["admin", "runtime"],
    queryFn: ({ signal }) => apiRequest("/admin/system/runtime", runtimeInspectionSchema, { signal }),
    enabled: useOwnerEnabled(),
    refetchInterval: 30_000,
  });
}

export function useVerifyCluster() {
  const queryClient = useQueryClient();
  const csrfToken = useCsrfToken();
  return useMutation({
    mutationFn: () =>
      apiRequest("/admin/system/cluster/verify", networkIdentitySchema, { method: "POST", csrfToken }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["system"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "overview"] });
    },
  });
}

export function useProviderHistory(limit: number) {
  return useQuery({
    queryKey: ["admin", "provider-history", limit],
    queryFn: ({ signal }) =>
      apiRequest(`/admin/system/provider-history?limit=${limit}`, z.array(providerHealthSnapshotSchema), {
        signal,
      }),
    enabled: useOwnerEnabled(),
    refetchInterval: 60_000,
  });
}

export function useJobs() {
  return useQuery({
    queryKey: ["admin", "jobs"],
    queryFn: ({ signal }) => apiRequest("/admin/jobs", jobsOverviewSchema, { signal }),
    enabled: useOwnerEnabled(),
    refetchInterval: 15_000,
  });
}

export function useRunProviderProbe() {
  const queryClient = useQueryClient();
  const csrfToken = useCsrfToken();
  return useMutation({
    mutationFn: () =>
      apiRequest("/admin/jobs/provider-health/run", enqueuedJobSchema, { method: "POST", csrfToken }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["admin", "jobs"] }),
  });
}

export function useRouteCatalog() {
  return useQuery({
    queryKey: ["admin", "routes"],
    queryFn: ({ signal }) => apiRequest("/admin/developer/routes", routeCatalogSchema, { signal }),
    enabled: useOwnerEnabled(),
    staleTime: Infinity,
  });
}

export function usePurgeCache() {
  const csrfToken = useCsrfToken();
  return useMutation({
    mutationFn: (target: "wallet-overview" | "permissions") =>
      apiRequest("/admin/developer/cache/purge", cachePurgeResponseSchema, {
        method: "POST",
        body: { target },
        csrfToken,
      }),
  });
}
