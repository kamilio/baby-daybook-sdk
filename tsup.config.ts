import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
    target: "node18",
  },
  {
    entry: { toolcraft: "src/toolcraft.ts" },
    format: ["esm"],
    banner: { js: 'import { createRequire as __babyDaybookCreateRequire } from "node:module"; const require = __babyDaybookCreateRequire(import.meta.url);' },
    dts: true,
    sourcemap: true,
    splitting: false,
    noExternal: [/^toolcraft(?:\/|$)/],
    target: "node18",
  },
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    banner: { js: '#!/usr/bin/env node\nimport { createRequire as __babyDaybookCreateRequire } from "node:module"; const require = __babyDaybookCreateRequire(import.meta.url);' },
    sourcemap: true,
    splitting: false,
    noExternal: [/^toolcraft(?:\/|$)/],
    target: "node18",
    outExtension: () => ({ js: ".js" }),
  },
]);
