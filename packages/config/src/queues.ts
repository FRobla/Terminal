/**
 * BullMQ queue and job names (ARCHITECTURE.md §13). Shared by the worker, which owns
 * the schedules and processes jobs, and the API, which inspects queues for the owner console.
 */
export const PROVIDER_HEALTH_QUEUE = "system.provider-health";
export const PROVIDER_HEALTH_PROBE_JOB = "probe-solana-rpc";
export const PROVIDER_HEALTH_SCHEDULER_ID = "solana-rpc-probe";
