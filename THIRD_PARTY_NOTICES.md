# Third-Party Notices

The standalone `baby-daybook` CLI, MCP servers, and generated Toolcraft SDKs bundle portions of the packages listed below. All entry points, including the low-level SDK, also bundle the Unicode PDF rendering packages and numeric font metrics described separately below.

## Unicode PDF rendering

All entry points bundle `fontkit@2.0.4`, `bidi-js@1.0.3`, and their supporting packages. Available upstream license texts and copyright notices are included in `data/pdf-fonts/SOFTWARE-LICENSES.txt`, including Apache 2.0 for `@swc/helpers` and the Google Brotli decoder sources, and MIT for the remaining packages. Where a package declares MIT but ships no license file, its author metadata and the standard MIT permission text are included explicitly.

The unmodified Noto font assets in `data/pdf-fonts` are distributed under the SIL Open Font License 1.1. Original notices are retained in `OFL-Noto.txt`, `OFL-CJK.txt`, and `OFL-Emoji.txt` alongside the fonts. `manifest.json` records each font's pinned upstream URL, SHA-256, and derived Unicode coverage ranges. Fonts are subsetted only when embedding used glyphs into an exported PDF; the distributed font files are unmodified. The download and manifest-generation script is `scripts/update-pdf-fonts.mjs`.

## Adobe Helvetica font metrics

The printable-ASCII advance widths in `src/pdf.ts` are derived from `Helvetica.afm`, version 002.000, in Adobe's Core 14 AFM distribution: `https://download.macromedia.com/pub/developer/opentype/tech-notes/Core14_AFMs.zip`.

Modification: the ASCII character advances were extracted into a numeric TypeScript array; other AFM data and font programs are not included.

Copyright (c) 1985, 1987, 1989, 1990, 1997 Adobe Systems Incorporated. All Rights Reserved.
Helvetica is a trademark of Linotype-Hell AG and/or its subsidiaries.

The distribution's permission notice follows unchanged:

This file and the 14 PostScript(R) AFM files it accompanies may be used, copied, and distributed for any purpose and without charge, with or without modification, provided that all copyright notices are retained; that the AFM files are not distributed without this file; that all modifications to this file or any of the AFM files are prominently noted in the modified file(s); and that this paragraph is not modified. Adobe Systems has no responsibility or obligation to support the use of the AFM files.

## Poe Platform Toolcraft packages

Included packages: `@poe-code/agent-defs@0.0.1`, `@poe-code/agent-human-in-loop@0.0.1`, `@poe-code/agent-mcp-config@0.0.1`, `@poe-code/config-mutations@0.0.1`, `@poe-code/frontmatter@0.0.1`, `@poe-code/process-runner@0.0.1`, `@poe-code/task-list@0.0.1`, `@poe-code/user-error@0.0.1`, `auth-store@0.0.1`, `fast-string-truncated-width@3.0.3`, `fast-string-width@3.0.2`, `fast-wrap-ansi@0.2.2`, `ignore@5.3.2`, `jose@6.2.3`, `jsonc-parser@3.3.1`, `mcp-oauth@0.0.1`, `mcp-oauth-server@0.1.0`, `sisteransi@1.0.5`, `smol-toml@1.6.1`, `tiny-http-mcp-server@0.1.7`, `tiny-mcp-client@0.1.0`, `tiny-stdio-mcp-server@0.1.0`, `toolcraft-design@0.0.2`, `toolcraft-schema@0.0.152`, `toolcraft@0.0.152`, `yaml@2.9.0`.

MIT License

Copyright (c) 2026 Poe Platform

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## commander@13.1.0

(The MIT License)

Copyright (c) 2011 TJ Holowaychuk <tj@vision-media.ca>

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
