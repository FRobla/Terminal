import { defineConfig } from "tsup";

// Self-contained server bundle: workspace packages ship TypeScript source and pnpm keeps their
// dependencies out of this app's resolution path, so everything is bundled. CommonJS dependencies
// need a real `require`, which the banner provides.
export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  target: "node24",
  platform: "node",
  outDir: "dist",
  clean: true,
  splitting: false,
  sourcemap: true,
  shims: true,
  noExternal: [/.*/],
  external: ["pino-pretty", "msgpackr-extract"],
  banner: {
    js: "import { createRequire as __sctCreateRequire } from 'node:module'; const require = __sctCreateRequire(import.meta.url);",
  },
});
