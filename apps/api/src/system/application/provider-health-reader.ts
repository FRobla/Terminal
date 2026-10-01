import { toProviderHealth, type ProviderDescriptor, type ProviderHealthStore } from "@sct/providers";
import type { ProviderHealth } from "@sct/validation";

/** Live provider health for every registered provider (SPEC-006). */
export async function readProviderHealth(
  providers: readonly ProviderDescriptor[],
  health: ProviderHealthStore,
): Promise<ProviderHealth[]> {
  const now = new Date();
  return Promise.all(
    providers.map(async (descriptor) =>
      toProviderHealth(descriptor, await health.read(descriptor.id, now), now),
    ),
  );
}
