import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { create } from "fontkit";

const destination = new URL("../data/pdf-fonts/", import.meta.url);
const noto = "https://raw.githubusercontent.com/notofonts/noto-fonts/ffebf8c1ee449e544955a7e813c54f9b73848eac";
const cjk = "https://raw.githubusercontent.com/notofonts/noto-cjk/f8d157532fbfaeda587e826d4cd5b21a49186f7c";
const google = "https://raw.githubusercontent.com/google/fonts/ade3d1533e06b2b1462ffcde8e08b129627ca360";
const families = [
  "NotoSans", "NotoSansArabic", "NotoSansHebrew", "NotoSansDevanagari", "NotoSansThai",
  "NotoSansArmenian", "NotoSansGeorgian", "NotoSansEthiopic", "NotoSansBengali",
  "NotoSansGujarati", "NotoSansGurmukhi", "NotoSansKannada", "NotoSerifMalayalam",
  "NotoSansOriya", "NotoSansSinhala", "NotoSansTamil", "NotoSansTelugu", "NotoSansLao",
  "NotoSansKhmer", "NotoSansMyanmar", "NotoSerifTibetan", "NotoSansMongolian",
  "NotoSansSyriac", "NotoSansThaana", "NotoSansCanadianAboriginal", "NotoSansCherokee",
  "NotoSansYi", "NotoSansSymbols2",
];
const sources = families.map((family) => ({
  file: `${family}-Regular.ttf`, url: `${noto}/hinted/ttf/${family}/${family}-Regular.ttf`,
}));
sources.push(
  { file: "NotoSansCJKsc-Regular.otf", url: `${cjk}/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf` },
  { file: "NotoEmoji.ttf", url: `${google}/ofl/notoemoji/NotoEmoji%5Bwght%5D.ttf` },
);
await mkdir(destination, { recursive: true });
async function download(url, file) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(new URL(file, destination), bytes);
  return bytes;
}
const manifest = [];
for (const source of sources) {
  const bytes = await download(source.url, source.file);
  const font = create(bytes);
  const ranges = [];
  for (const code of [...font.characterSet].sort((left, right) => left - right)) {
    const last = ranges.at(-1);
    if (last && code === last[1] + 1) last[1] = code;
    else ranges.push([code, code]);
  }
  manifest.push({ ...source, sha256: createHash("sha256").update(bytes).digest("hex"), ranges });
  console.log(source.file, bytes.length, ranges.length);
}
for (const [url, file] of [[`${noto}/LICENSE`, "OFL-Noto.txt"], [`${cjk}/Sans/LICENSE`, "OFL-CJK.txt"], [`${google}/ofl/notoemoji/OFL.txt`, "OFL-Emoji.txt"]]) {
  const text = (await download(url, file)).toString("utf8").replaceAll(/[\t ]+$/gm, "").trimEnd();
  await writeFile(new URL(file, destination), `${text}\n`);
}
await writeFile(new URL("manifest.json", destination), `${JSON.stringify(manifest, null, 2)}\n`);
const packages = ["fontkit", "bidi-js", "@swc/helpers", "brotli", "clone", "dfa", "fast-deep-equal", "restructure", "tiny-inflate", "unicode-properties", "unicode-trie", "base64-js", "pako", "require-from-string"];
const notices = [];
for (const name of packages) {
  const directory = new URL(`../node_modules/${name}/`, import.meta.url);
  const metadata = JSON.parse(await readFile(new URL("package.json", directory), "utf8"));
  const licenses = (await readdir(directory)).filter((file) => /^licen[cs]e(?:\.|$)/i.test(file));
  let text = (await Promise.all(licenses.map((file) => readFile(new URL(file, directory), "utf8")))).join("\n");
  if (licenses.length === 0) {
    if (metadata.license !== "MIT") throw new Error(`Missing license for ${name}`);
    const mit = await readFile(new URL("../node_modules/restructure/LICENSE", import.meta.url), "utf8");
    text = `Declared license: MIT\nAuthor: ${metadata.author}\nUpstream declares MIT in package.json and README.md but ships no separate license file. The standard MIT permission text follows.\n\n${mit.slice(mit.indexOf("Permission is hereby granted"))}`;
  }
  if (name === "brotli") {
    const decoder = await readFile(new URL("dec/decode.js", directory), "utf8");
    text += `\nAdditional notice for the decoder sources (Apache 2.0 text is included under @swc/helpers):\n${decoder.slice(0, decoder.indexOf("*/") + 2)}\n`;
  }
  notices.push(`${name}@${metadata.version}\n${"=".repeat(60)}\n${text}`);
}
await writeFile(new URL("SOFTWARE-LICENSES.txt", destination), `${notices.join("\n\n").replaceAll(/[\t ]+$/gm, "").trimEnd()}\n`);
console.log(fileURLToPath(destination));
