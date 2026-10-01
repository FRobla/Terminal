// Verifies that test-only code never ships in the terminal production bundle (TESTING.md §7, FND-AC-08).
// Run after `pnpm --filter @sct/terminal build`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const FORBIDDEN_MARKERS = ["__SCT_TEST_WALLET__", "installTestWallet", "startStubRpcServer", "@sct/testing"];
const roots = ["apps/terminal/.next/static", "apps/terminal/.next/server"];

const offenders = [];
function scan(directory) {
  for (const entry of readdirSync(directory)) {
    const file = path.join(directory, entry);
    if (statSync(file).isDirectory()) {
      scan(file);
    } else if (/\.(js|mjs|cjs|html|json)$/.test(entry)) {
      const content = readFileSync(file, "utf8");
      for (const marker of FORBIDDEN_MARKERS) {
        if (content.includes(marker)) offenders.push(`${file}: ${marker}`);
      }
    }
  }
}

for (const root of roots) {
  try {
    scan(root);
  } catch {
    console.error(`Build output not found at ${root}. Build the terminal first.`);
    process.exit(1);
  }
}

if (offenders.length > 0) {
  console.error(`Test-only code found in the production bundle:\n${offenders.join("\n")}`);
  process.exit(1);
}
console.warn("Production bundle check passed: no test-only code found.");
