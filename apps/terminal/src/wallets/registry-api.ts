"use client";

import {
  managedWalletSchema,
  organizationMembersSchema,
  ownershipChallengeResponseSchema,
  walletHistorySchema,
  walletListSchema,
  walletSyncResponseSchema,
  type CustodyType,
  type RegisterWalletRequest,
  type UpdateWalletRequest,
  type WalletCategory,
  type WalletRole,
  type WalletStatus,
} from "@sct/validation";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "../auth/use-session";
import { apiRequest, apiRequestWithMeta } from "../platform/api-client";

/** SPEC-009 — wallet registry queries and mutations. Every key starts with "wallets" (cleared on sign-out). */

export interface WalletFilters {
  status: WalletStatus;
  category?: WalletCategory | undefined;
  custodyType?: CustodyType | undefined;
  tag?: string | undefined;
  q?: string | undefined;
}

function filterQuery(filters: WalletFilters, cursor: string | undefined): string {
  const params = new URLSearchParams({ status: filters.status });
  if (filters.category) params.set("category", filters.category);
  if (filters.custodyType) params.set("custodyType", filters.custodyType);
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.q) params.set("q", filters.q);
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

export function useWalletList(filters: WalletFilters, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ["wallets", "registry", "list", filters],
    queryFn: ({ pageParam, signal }) =>
      apiRequestWithMeta(`/wallets?${filterQuery(filters, pageParam)}`, walletListSchema, { signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
    enabled,
  });
}

export function useManagedWallet(walletId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["wallets", "registry", "detail", walletId],
    queryFn: ({ signal }) =>
      apiRequest(`/wallets/${encodeURIComponent(walletId)}`, managedWalletSchema, { signal }),
    enabled,
  });
}

export function useWalletHistory(walletId: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ["wallets", "registry", "history", walletId],
    queryFn: ({ pageParam, signal }) =>
      apiRequestWithMeta(
        `/wallets/${encodeURIComponent(walletId)}/transactions?limit=25${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`,
        walletHistorySchema,
        { signal },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
    enabled,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

export function useOrganizationMembers(enabled: boolean) {
  return useQuery({
    queryKey: ["wallets", "registry", "members"],
    queryFn: ({ signal }) => apiRequest("/organization/members", organizationMembersSchema, { signal }),
    enabled,
  });
}

/** Mutations need the session's CSRF token; they refresh every registry query afterwards. */
function useRegistryMutation<TVariables, TResult>(
  mutationFn: (variables: TVariables, csrfToken: string | undefined) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  const { session } = useSession();
  return useMutation({
    mutationFn: (variables: TVariables) => mutationFn(variables, session?.csrfToken),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["wallets", "registry"] }),
  });
}

/** Requests an ownership challenge and has the wallet sign it (SPEC-009 §4.2). */
export async function proveWalletControl(
  address: string,
  signMessage: (message: Uint8Array) => Promise<Uint8Array>,
  csrfToken: string | undefined,
): Promise<{ challengeId: string; signature: string }> {
  const challenge = await apiRequest("/wallets/ownership-challenges", ownershipChallengeResponseSchema, {
    method: "POST",
    csrfToken,
    body: { address },
  });
  const signature = await signMessage(new TextEncoder().encode(challenge.message));
  let binary = "";
  for (const byte of signature) binary += String.fromCharCode(byte);
  return { challengeId: challenge.challengeId, signature: btoa(binary) };
}

export function useRegisterWallet() {
  return useRegistryMutation((request: RegisterWalletRequest, csrfToken) =>
    apiRequest("/wallets", managedWalletSchema, { method: "POST", csrfToken, body: request }),
  );
}

export function useUpdateWallet(walletId: string) {
  return useRegistryMutation((request: UpdateWalletRequest, csrfToken) =>
    apiRequest(`/wallets/${encodeURIComponent(walletId)}`, managedWalletSchema, {
      method: "PATCH",
      csrfToken,
      body: request,
    }),
  );
}

export function useAssignmentChange(walletId: string) {
  return useRegistryMutation(
    (variables: { operation: "assign" | "unassign"; userId: string; role: WalletRole }, csrfToken) =>
      variables.operation === "assign"
        ? apiRequest(`/wallets/${encodeURIComponent(walletId)}/assignments`, managedWalletSchema, {
            method: "POST",
            csrfToken,
            body: { userId: variables.userId, role: variables.role },
          })
        : apiRequest(
            `/wallets/${encodeURIComponent(walletId)}/assignments/${encodeURIComponent(variables.userId)}/${variables.role}`,
            managedWalletSchema,
            { method: "DELETE", csrfToken },
          ),
  );
}

export function useRequestSync(walletId: string) {
  return useRegistryMutation((_: void, csrfToken) =>
    apiRequest(`/wallets/${encodeURIComponent(walletId)}/sync`, walletSyncResponseSchema, {
      method: "POST",
      csrfToken,
    }),
  );
}
