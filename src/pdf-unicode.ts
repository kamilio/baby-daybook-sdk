import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { create } from "fontkit";
import type { Font, Glyph, GlyphRun, Subset } from "fontkit";
import bidiFactory from "bidi-js";

interface FontSource {
  file: string;
  ranges: Array<[number, number]>;
}

interface TextRun {
  font: Font;
  text: string;
  level: number;
  order: number;
}

interface ShapedRun {
  font: Font;
  run: GlyphRun;
}

interface FontUsage {
  font: Font;
  subset: Subset;
  reference: number;
  name: string;
  widths: number[];
  unicode: Map<number, string>;
}

interface PdfLayout {
  width: number;
  height: number;
  margin: number;
  lineHeight: number;
  fontSize: number;
  asciiText: (text: string) => string;
}

const moduleDirectory = typeof __dirname === "string" ? __dirname : dirname(fileURLToPath(import.meta.url));
const fontDirectory = resolve(moduleDirectory, "..", "data", "pdf-fonts");
const fontData = new Map<string, Buffer>();
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const bidi = bidiFactory();
let sources: FontSource[] | undefined;

export function containsUnicode(text: string): boolean {
  return /[^\p{ASCII}]/u.test(text);
}

export function splitPdfGraphemes(text: string): string[] {
  return [...segmenter.segment(text)].map(({ segment }) => segment);
}

function selectFont(text: string, fonts: Map<string, Font>): Font {
  sources ??= JSON.parse(readFileSync(resolve(fontDirectory, "manifest.json"), "utf8")) as FontSource[];
  const characters = [...text].filter((character) => !/\p{Default_Ignorable_Code_Point}/u.test(character));
  const supports = (source: FontSource) => characters.every((character) => {
    const code = character.codePointAt(0)!;
    return source.ranges.some(([start, end]) => code >= start && code <= end);
  });
  const emoji = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(text);
  const source = (emoji ? sources.find((candidate) => candidate.file === "NotoEmoji.ttf" && supports(candidate)) : undefined)
    ?? sources.find(supports);
  if (!source) {
    const codes = characters.map((character) => `U+${character.codePointAt(0)!.toString(16).toUpperCase()}`);
    throw new Error(`PDF fonts do not support ${codes.join(" ")}. Use a CSV export to retain this text.`);
  }
  let font = fonts.get(source.file);
  if (!font) {
    let bytes = fontData.get(source.file);
    if (!bytes) {
      bytes = readFileSync(resolve(fontDirectory, source.file));
      fontData.set(source.file, bytes);
    }
    font = create(bytes) as Font;
    fonts.set(source.file, font);
  }
  return font;
}

function shapeText(text: string): ShapedRun[] {
  const fonts = new Map<string, Font>();
  const levels = bidi.getEmbeddingLevels(text, "ltr");
  const visualIndices = bidi.getReorderedIndices(text, levels);
  const order = new Map(visualIndices.map((logicalIndex, visualIndex) => [logicalIndex, visualIndex]));
  const mirrors = bidi.getMirroredCharactersMap(text, levels);
  const runs: TextRun[] = [];
  for (const { segment, index } of segmenter.segment(text)) {
    if (/^\p{Default_Ignorable_Code_Point}+$/u.test(segment) && runs.length > 0) {
      runs.at(-1)!.text += segment;
      continue;
    }
    const font = selectFont(segment, fonts);
    const level = levels.levels[index]!;
    const visualOrder = Math.min(...Array.from({ length: segment.length }, (_, offset) => order.get(index + offset)!));
    const mirrored = segment.split("").map((character, offset) => mirrors.get(index + offset) ?? character).join("");
    const previous = runs.at(-1);
    if (previous && previous.font === font && previous.level === level) {
      previous.text += mirrored;
      previous.order = Math.min(previous.order, visualOrder);
    } else {
      runs.push({ font, text: mirrored, level, order: visualOrder });
    }
  }
  return runs.sort((left, right) => left.order - right.order).map(({ font, text: value, level }) => ({
    font, run: font.layout(value, { rtlm: false }, undefined, undefined, level % 2 ? "rtl" : "ltr"),
  }));
}

export function unicodeTextWidth(text: string): number {
  return shapeText(text).reduce((width, { font, run }) => width + run.advanceWidth * 1000 / font.unitsPerEm, 0);
}

function unicodeHex(text: string): string {
  return Buffer.from(text, "utf16le").swap16().toString("hex").toUpperCase();
}

function number(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

export function encodeUnicodePdf(pages: readonly (readonly string[])[], layout: PdfLayout): Uint8Array {
  const objects: Buffer[] = [Buffer.alloc(0), Buffer.alloc(0), Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")];
  const usages = new Map<string, FontUsage>();
  const add = (value: string | Buffer) => objects.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
  const stream = (data: Buffer, attributes = "") => Buffer.concat([
    Buffer.from(`<< /Length ${data.length}${attributes} >>\nstream\n`), data, Buffer.from("\nendstream"),
  ]);
  const glyphCode = (font: Font, glyph: Glyph) => {
    let usage = usages.get(font.postscriptName);
    if (!usage) {
      usage = { font, subset: font.createSubset(), reference: add(""), name: `F${usages.size + 2}`, widths: [0], unicode: new Map() };
      usages.set(font.postscriptName, usage);
    }
    if (glyph.id === 0) throw new Error(`PDF font could not shape ${glyph.codePoints.map((code) => `U+${code.toString(16).toUpperCase()}`).join(" ")}`);
    const code = Number(usage.subset.includeGlyph(glyph));
    usage.widths[code] = glyph.advanceWidth * 1000 / font.unitsPerEm;
    if (glyph.codePoints.length > 0 && !usage.unicode.has(code)) usage.unicode.set(code, unicodeHex(String.fromCodePoint(...glyph.codePoints)));
    return { usage, code: code.toString(16).padStart(4, "0").toUpperCase() };
  };
  const pageReferences: number[] = [];
  pages.forEach((lines, pageIndex) => {
    const content: string[] = [];
    [...lines, "", `Page ${pageIndex + 1} of ${pages.length}`].forEach((line, lineIndex) => {
      const baseline = layout.height - layout.margin - lineIndex * layout.lineHeight;
      if (!containsUnicode(line)) {
        content.push(`BT /F1 ${layout.fontSize} Tf 1 0 0 1 ${layout.margin} ${baseline} Tm (${layout.asciiText(line)}) Tj ET`);
        return;
      }
      const runs = shapeText(line);
      const width = runs.reduce((sum, { font, run }) => sum + run.advanceWidth / font.unitsPerEm, 0);
      let top = 0;
      let bottom = 0;
      for (const { font, run } of runs) {
        run.glyphs.forEach((glyph, index) => {
          top = Math.max(top, (glyph.bbox.maxY + run.positions[index]!.yOffset) / font.unitsPerEm);
          bottom = Math.min(bottom, (glyph.bbox.minY + run.positions[index]!.yOffset) / font.unitsPerEm);
        });
      }
      const size = Math.min(layout.fontSize, (layout.lineHeight - 1) / Math.max(1, top - bottom));
      const horizontalScale = Math.min(1, (layout.width - layout.margin * 2) / Math.max(1, width * size));
      let cursor = layout.margin;
      content.push(`/Span << /ActualText <FEFF${unicodeHex(line)}> >> BDC`, "BT");
      for (const { font, run } of runs) {
        run.glyphs.forEach((glyph, index) => {
          const position = run.positions[index]!;
          const { usage, code } = glyphCode(font, glyph);
          const scale = size / font.unitsPerEm;
          const horizontal = cursor + position.xOffset * scale * horizontalScale;
          const vertical = baseline + position.yOffset * scale;
          content.push(`/${usage.name} ${number(size)} Tf ${number(horizontalScale)} 0 0 1 ${number(horizontal)} ${number(vertical)} Tm <${code}> Tj`);
          cursor += position.xAdvance * scale * horizontalScale;
        });
      }
      content.push("ET", "EMC");
    });
    const contents = add(stream(Buffer.from(content.join("\n"))));
    const page = add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${layout.width} ${layout.height}] /Resources << /Font << /F1 3 0 R ${[...usages.values()].map((usage) => `/${usage.name} ${usage.reference} 0 R`).join(" ")} >> >> /Contents ${contents} 0 R >>`);
    pageReferences.push(page);
  });
  for (const usage of usages.values()) {
    const { font, subset } = usage;
    const cff = "cff" in subset;
    const bytes = subset.encode();
    const file = add(stream(deflateSync(bytes), ` /Filter /FlateDecode${cff ? " /Subtype /CIDFontType0C" : ` /Length1 ${bytes.length}`}`));
    const scale = 1000 / font.unitsPerEm;
    const tag = usage.name.slice(1).padStart(6, "0").split("").map((digit) => String.fromCharCode(65 + Number(digit))).join("");
    const name = `${tag}+${font.postscriptName.replaceAll(/[^a-zA-Z0-9-]/g, "")}`;
    const box = [font.bbox.minX, font.bbox.minY, font.bbox.maxX, font.bbox.maxY].map((value) => number(value * scale)).join(" ");
    const descriptor = add(`<< /Type /FontDescriptor /FontName /${name} /Flags 4 /FontBBox [${box}] /ItalicAngle ${number(font.italicAngle)} /Ascent ${number(font.ascent * scale)} /Descent ${number(font.descent * scale)} /CapHeight ${number(font.capHeight * scale)} /StemV 80 /FontFile${cff ? 3 : 2} ${file} 0 R >>`);
    const descendant = add(`<< /Type /Font /Subtype /CIDFontType${cff ? 0 : 2} /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptor} 0 R${cff ? "" : " /CIDToGIDMap /Identity"} /W [0 [${usage.widths.map(number).join(" ")}]] >>`);
    const mappings = [...usage.unicode].map(([code, value]) => `<${code.toString(16).padStart(4, "0").toUpperCase()}> <${value}>`);
    const blocks: string[] = [];
    for (let start = 0; start < mappings.length; start += 100) {
      const block = mappings.slice(start, start + 100);
      blocks.push(`${block.length} beginbfchar`, ...block, "endbfchar");
    }
    const cmap = add(stream(Buffer.from([
      "/CIDInit /ProcSet findresource begin", "12 dict begin", "begincmap",
      "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
      `/CMapName /${usage.name}-UCS def`, "/CMapType 2 def", "1 begincodespacerange", "<0000> <FFFF>",
      "endcodespacerange", ...blocks, "endcmap", "CMapName currentdict /CMap defineresource pop", "end", "end",
    ].join("\n"))));
    objects[usage.reference - 1] = Buffer.from(`<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H /DescendantFonts [${descendant} 0 R] /ToUnicode ${cmap} 0 R >>`);
  }
  objects[0] = Buffer.from("<< /Type /Catalog /Pages 2 0 R >>");
  objects[1] = Buffer.from(`<< /Type /Pages /Kids [${pageReferences.map((page) => `${page} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  const parts = [Buffer.from("%PDF-1.4\n%BabyDaybookSDK\n")];
  let length = parts[0]!.length;
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(length);
    const part = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from("\nendobj\n")]);
    parts.push(part);
    length += part.length;
  });
  parts.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));
  return new Uint8Array(Buffer.concat(parts));
}
