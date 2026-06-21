import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

for (const name of ["cli.js", "toolcraft.js", "toolcraft-http.js"]) {
  await canonicalize(path.join(packageRoot, "dist", name));
}

async function canonicalize(artifactPath) {
  const source = await readFile(artifactPath, "utf8");
  const canonicalSource = source
    .replace(/^(\s*\/\/ )(?:\.\.\/)+node_modules\//gm, "$1node_modules/")
    .replace(/^(\s*")(?:\.\.\/)+node_modules\/([^"\n]+)"(\([^\n]*\) \{)$/gm, '$1node_modules/$2"$3');
  if (canonicalSource !== source) await writeFile(artifactPath, canonicalSource);

  const mapPath = `${artifactPath}.map`;
  const sourceMap = JSON.parse(await readFile(mapPath, "utf8"));
  if (!Array.isArray(sourceMap.sources)) throw new Error(`${path.basename(mapPath)} has no source inventory`);
  sourceMap.sources = sourceMap.sources.map((entry) => {
    if (typeof entry !== "string") throw new Error(`${path.basename(mapPath)} contains a non-string source`);
    const marker = "node_modules/";
    const offset = entry.indexOf(marker);
    return offset < 0 ? entry : `../${entry.slice(offset)}`;
  });
  await writeFile(mapPath, JSON.stringify(sourceMap));
}
