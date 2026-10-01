import { parsePublicEnvironment } from "@sct/config/public";

/** Browser-exposed configuration, inlined at build time and validated at load. */
export const publicConfig = parsePublicEnvironment({
  NEXT_PUBLIC_SOLANA_CLUSTER: process.env.NEXT_PUBLIC_SOLANA_CLUSTER,
});
