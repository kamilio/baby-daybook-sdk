import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
    target: "node20",
  },
  {
    entry: { toolcraft: "src/toolcraft.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    splitting: false,
    noExternal: [/^toolcraft(?:\/|$)/],
    target: "node20",
  },
  {
    entry: { "toolcraft-http": "src/toolcraft-http.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    splitting: false,
    noExternal: [/^toolcraft(?:\/|$)/],
    target: "node20",
  },
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    banner: { js: "#!/usr/bin/env node" },
    sourcemap: true,
    splitting: false,
    noExternal: [/^toolcraft(?:\/|$)/],
    target: "node20",
    outExtension: () => ({ js: ".js" }),
  },
]);
