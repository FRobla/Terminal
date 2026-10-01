import { localKeyRecordSchema, type LocalKeyRecord } from "./local-key-record";

/** SPEC-010 §3 — IndexedDB database `sct-local-wallets`, store `keys`, keyed by address. */
const DATABASE_NAME = "sct-local-wallets";
const STORE_NAME = "keys";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "address" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB could not be opened"));
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = operation(transaction.objectStore(STORE_NAME));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    });
  } finally {
    database.close();
  }
}

export async function saveLocalKey(record: LocalKeyRecord): Promise<void> {
  // `add`, not `put`: a stored key is never silently overwritten.
  await run("readwrite", (store) => store.add(localKeyRecordSchema.parse(record)));
}

/** Records that fail validation (corrupted, or from an unknown version) are ignored rather than trusted. */
export async function listLocalKeys(): Promise<LocalKeyRecord[]> {
  const rows = await run("readonly", (store) => store.getAll() as IDBRequest<unknown[]>);
  return rows.flatMap((row) => {
    const parsed = localKeyRecordSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

export async function deleteLocalKey(address: string): Promise<void> {
  await run("readwrite", (store) => store.delete(address));
}
