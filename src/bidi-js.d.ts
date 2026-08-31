declare module "bidi-js" {
  interface EmbeddingLevels {
    levels: Uint8Array;
    paragraphs: Array<{ start: number; end: number; level: number }>;
  }
  export default function bidiFactory(): {
    getEmbeddingLevels(text: string, direction?: "ltr" | "rtl"): EmbeddingLevels;
    getReorderedIndices(text: string, levels: EmbeddingLevels): number[];
    getMirroredCharactersMap(text: string, levels: EmbeddingLevels): Map<number, string>;
  };
}
