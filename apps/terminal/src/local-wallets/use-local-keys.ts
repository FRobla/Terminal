"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useIsHydrated } from "../wallets/wallet-client";
import { deleteLocalKey, listLocalKeys, saveLocalKey } from "./local-key-store";
import type { LocalKeyRecord } from "./local-key-record";
import { isEd25519Supported } from "./local-key-vault";

/** Device-local state: never sent to the API, and not tied to the session. */
const LOCAL_KEYS_QUERY_KEY = ["local-wallets", "keys"] as const;

export function useLocalKeys() {
  const hydrated = useIsHydrated();
  return useQuery({
    queryKey: LOCAL_KEYS_QUERY_KEY,
    queryFn: listLocalKeys,
    enabled: hydrated && typeof indexedDB !== "undefined",
    staleTime: Infinity,
  });
}

/** LWG-AC-06 — addresses whose encrypted key is stored in this browser. */
export function useLocalKeyAddresses(): Set<string> | undefined {
  const keys = useLocalKeys();
  return keys.data ? new Set(keys.data.map((record) => record.address)) : undefined;
}

export function useEd25519Support() {
  const hydrated = useIsHydrated();
  return useQuery({
    queryKey: ["local-wallets", "ed25519-support"],
    queryFn: isEd25519Supported,
    enabled: hydrated,
    staleTime: Infinity,
  });
}

export function useSaveLocalKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (record: LocalKeyRecord) => saveLocalKey(record),
    onSettled: () => queryClient.invalidateQueries({ queryKey: LOCAL_KEYS_QUERY_KEY }),
  });
}

export function useDeleteLocalKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (address: string) => deleteLocalKey(address),
    onSettled: () => queryClient.invalidateQueries({ queryKey: LOCAL_KEYS_QUERY_KEY }),
  });
}
