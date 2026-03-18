<p align="center">
  <img src=".github/assets/logo.png" alt="rs-pdf" width="160" />
</p>

<h1 align="center">@rs-pdf/core</h1>

<p align="center">
  High-performance PDF → HTML converter.<br>
  MuPDF under the hood, exposed as a Node.js native addon via Rust + napi-rs.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@rs-pdf/core"><img src="https://img.shields.io/npm/v/%40rs-pdf%2Fcore?style=flat-square" alt="npm" /></a>
  <a href="https://github.com/olebuda/rs-pdf/actions/workflows/test.yml"><img src="https://img.shields.io/github/actions/workflow/status/olebuda/rs-pdf/test.yml?label=tests&style=flat-square" alt="tests" /></a>
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT" />
</p>

---

## Why

- **MuPDF** is the fastest PDF renderer available - same engine used by Foxit, Chrome, and Kindle
- **Pixel-perfect SVG output** - text rendered as vector paths, no rasterization artifacts
- **Optional SEO text layer** - transparent HTML text overlay, crawlable by search engines and copy-pasteable by users
- **Zero runtime dependencies** - MuPDF is statically linked into the `.node` binary
- **Non-blocking** - all rendering runs on Tokio's blocking thread pool, never blocking the Node.js event loop

## Installation

```sh
npm install @rs-pdf/core
# or
pnpm add @rs-pdf/core
```

The correct native binary for your platform is installed automatically via `optionalDependencies`.

**Supported platforms:** macOS (arm64, x64) · Linux (x64, arm64 glibc) · Windows (x64)

## Usage

All functions accept a single input object with either `path` (local file) or `url` (remote file).
When `url` is given, the PDF is downloaded to a temporary location and cleaned up automatically.

### Convert entire PDF

```ts
import { pdfToHtml } from '@rs-pdf/core';

// from local file
const result = await pdfToHtml({ path: '/path/to/file.pdf' });

// from URL
const result = await pdfToHtml({ url: 'https://example.com/document.pdf' });

console.log(result.pageCount); // total pages
console.log(result.pagesConverted); // pages actually converted
console.log(result.html); // self-contained HTML document
```

### Page range & DPI

```ts
const result = await pdfToHtml({
  path: '/path/to/file.pdf',
  startPage: 0, // 0-based, default: 0
  endPage: 9,   // 0-based inclusive, default: last page
  dpi: 200,     // render quality, default: 150
});
```

### SEO text layer

Adds a transparent HTML text overlay on top of the SVG - invisible to users,
but indexed by search engine crawlers and copy-pasteable.

```ts
const result = await pdfToHtml({ path: '/path/to/file.pdf', seoTextLayer: true });
// result.html contains: SVG visual layer + <div class="tl"> text overlay
```

### DRM-protected PDFs

```ts
const result = await pdfToHtml({ path: '/path/to/protected.pdf', password: 'secret' });
```

### Stream page by page

Yields pages as they are converted - useful for large PDFs or when you want
to process/save pages without waiting for the entire document.

```ts
import { pdfToHtmlStream } from '@rs-pdf/core';

for await (const page of pdfToHtmlStream({ path: '/large.pdf' })) {
  console.log(`Page ${page.pageIndex + 1}/${page.pageCount}`);
  await saveToDatabase(page.html);
}
```

Use `concurrency` to prefetch multiple pages in parallel:

```ts
for await (const page of pdfToHtmlStream({ url: 'https://example.com/doc.pdf', concurrency: 4 })) {
  process(page);
}
```

### Single page

```ts
import { pdfPageToHtml } from '@rs-pdf/core';

const page = await pdfPageToHtml({ path: '/path/to/file.pdf', pageIndex: 3 });
// page.html is a fragment - no DOCTYPE/html/head/body
```

### Metadata only

```ts
import { pdfInfo } from '@rs-pdf/core';

const info = await pdfInfo({ path: '/path/to/file.pdf' });
// or: await pdfInfo({ url: 'https://example.com/doc.pdf' })
// { pageCount, isDrmProtected, title, author, subject, creator }
```

### Worker pool

Limit concurrent PDF conversions when processing large batches:

```ts
import { PdfWorkerPool } from '@rs-pdf/core';

const pool = new PdfWorkerPool({ concurrency: 4 });

const results = await Promise.all(
  pdfPaths.map((p) => pool.convert({ path: p, dpi: 150 }))
);

// stream via pool
for await (const page of pool.stream({ url: 'https://example.com/large.pdf' })) {
  process(page);
}

pool.destroy();
```

## API

All functions accept a single input object. Provide either `path` or `url` — not both.

### `pdfToHtml(input): Promise<PdfConvertResult>`

Converts all (or a range of) pages to a self-contained HTML document.

### `pdfPageToHtml(input): Promise<PdfPageResult>`

Converts a single page to an HTML fragment (no DOCTYPE/html/head/body).

### `pdfToHtmlStream(input): AsyncGenerator<PdfPageResult>`

Yields pages one by one as they are converted.

### `pdfInfo(input): Promise<PdfInfo>`

Returns document metadata without rendering. Safe to call on DRM-protected PDFs.

### `PdfWorkerPool`

Concurrency-limited pool. See [Worker pool](#worker-pool) above.

### Input fields

| Field          | Type      | Default   | Applies to          | Description                                 |
| -------------- | --------- | --------- | ------------------- | ------------------------------------------- |
| `path`         | `string`  | -         | all                 | Local file path (mutually exclusive with `url`) |
| `url`          | `string`  | -         | all                 | Remote URL — downloaded automatically       |
| `pageIndex`    | `number`  | -         | `pdfPageToHtml`     | 0-based page index (required)               |
| `startPage`    | `number`  | `0`       | all except `pdfInfo`| First page to convert (0-based)             |
| `endPage`      | `number`  | last page | all except `pdfInfo`| Last page to convert (0-based, inclusive)   |
| `password`     | `string`  | -         | all                 | Password for DRM-protected PDFs             |
| `dpi`          | `number`  | `150`     | all except `pdfInfo`| Render quality (higher = larger output)     |
| `seoTextLayer` | `boolean` | `false`   | all except `pdfInfo`| Add transparent HTML text overlay for SEO   |
| `concurrency`  | `number`  | `1`       | `pdfToHtmlStream`   | Pages to prefetch in parallel               |

## HTML output structure

```html
<!-- Full document (pdfToHtml) -->
<!DOCTYPE html>
<html>
  <head>
    ...
  </head>
  <body>
    <div class="page" id="page-1" data-page="1" data-total="42">
      <div style="position:relative; width:...px; height:...px">
        <!-- Visual layer: pixel-perfect SVG (text as vector paths) -->
        <svg>...</svg>

        <!-- SEO text layer (only when seoTextLayer: true) -->
        <!-- Invisible to users, readable by crawlers, copy-pasteable -->
        <div class="tl" style="color:transparent; ...">
          <p><span>Actual text content from PDF</span></p>
        </div>
      </div>
    </div>
  </body>
</html>
```

## Development

```sh
# Install dependencies
pnpm install

# Build native addon (Rust → .node)
pnpm build:native

# Build TypeScript
pnpm build:ts

# Run tests
pnpm test

# Build everything
pnpm build
```

**Requirements:** Rust stable, Node.js 18+, pnpm

## License

MIT
