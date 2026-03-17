# AGENTS.md — rs-pdf

High-performance PDF → HTML converter: MuPDF (C) wrapped via Rust + napi-rs → Node.js native addon.

## Architecture

```
libmupdf (C, bundled via mupdf-sys)
  ↕ safe Rust bindings (mupdf crate 0.6.0)
src/lib.rs  (Rust, napi-rs #[napi] exports)
  ↕ compiled to .node binary
dist/rs-pdf.<platform>.node
  ↕ loaded at runtime via createRequire
src/index.ts  (TypeScript public API)
  ↕ compiled by tsdown (vp pack)
dist/index.js + dist/index.cjs + dist/index.d.ts
```

## Key Files

| Path                | Purpose                                                             |
| ------------------- | ------------------------------------------------------------------- |
| `src/lib.rs`        | Rust implementation: `pdfToHtml`, `pdfInfo` exports via napi-rs     |
| `src/index.ts`      | TypeScript wrapper — loads `.node` binary, re-exports typed API     |
| `src/index.test.ts` | vitest test suite                                                   |
| `Cargo.toml`        | Rust dependencies: `mupdf`, `napi`, `napi-derive`, `rayon`, `tokio` |
| `vite.config.ts`    | Unified config: tsdown (pack) + vitest (test) via vite+             |
| `tsconfig.json`     | TypeScript config                                                   |

## Commands

```bash
pnpm build:native   # Compile Rust → dist/rs-pdf.<platform>.node (release)
pnpm build:ts       # Compile TypeScript → dist/ (tsdown via vp pack)
pnpm build          # Full build (native + ts)
pnpm test           # Run vitest suite (vp test)
pnpm check          # Type-check + lint (vp check)
```

## HTML Output Structure

Each page produces a dual-layer structure:

```html
<div class="page" id="page-1">
  <div style="position:relative; width:Xpx; height:Ypx; overflow:hidden;">
    <!-- Layer 1: SVG — pixel-perfect visual rendering (text as vector paths) -->
    <svg ...>...</svg>

    <!-- Layer 2: SEO text layer — transparent overlay, crawlable by search engines -->
    <!-- color:transparent = invisible to users                                    -->
    <!-- user-select:text  = copy-pasteable by users                              -->
    <!-- pointer-events:none = doesn't block SVG interactions                     -->
    <!-- CSS transform:scale() maps PDF point coords → rendered pixel coords      -->
    <div class="tl" style="position:absolute; color:transparent; user-select:text; ...">
      <div id="page0">
        <p style="top:...px; left:...px; ...">
          <span style="font-family:...; font-size:...pt; ...">actual text</span>
        </p>
      </div>
    </div>
  </div>
</div>
```

**Why dual-layer:**

- SVG text is rendered as vector paths — zero `<text>` elements → invisible to crawlers
- Text layer contains real DOM text → fully indexed by Google/Bing/etc.
- `color: transparent` (not `display:none`) → Google indexes it, no cloaking penalties

## Public API

```typescript
import { pdfToHtml, pdfInfo } from 'rs-pdf'

// Convert PDF to self-contained HTML (SVG per page)
const result = await pdfToHtml('/path/to/file.pdf', {
  startPage?: number,  // 0-based, default 0
  endPage?: number,    // 0-based inclusive, default last page
  password?: string,   // for DRM-protected PDFs
  dpi?: number,        // SVG render quality, default 150
})
// result: { html, pageCount, isDrmProtected, pagesConverted }

// Get metadata without converting
const info = await pdfInfo('/path/to/file.pdf', password?)
// info: { pageCount, isDrmProtected, title?, author?, subject?, creator? }
```

## Important Constraints

- **Async always**: all operations run on a blocking thread via `tokio::task::spawn_blocking` — never blocks the Node.js event loop.
- **DRM handling**: `pdfInfo` never throws on DRM-protected PDFs (returns `isDrmProtected: true`, `pageCount: 0`). `pdfToHtml` throws unless a valid `password` is supplied.
- **Page indexing**: all page parameters are **0-based**.
- **MuPDF is bundled**: `mupdf-sys` compiles libmupdf from C source during `cargo build`. No system MuPDF installation required. First build takes ~1–2 minutes.
- **`.node` binary goes to `dist/`**: `napi build --out-dir dist`. The TS loader searches `__dirname` then `__dirname/../dist/` to support both compiled and source contexts.
- **`clean: false` in pack config**: prevents tsdown from deleting `.node` files in `dist/` on rebuild.

## Adding New Functionality

1. Add the Rust function in `src/lib.rs` with `#[napi]` attribute.
2. Run `pnpm build:native` to recompile the `.node` binary.
3. Export the function from `src/index.ts` with proper TypeScript types.
4. Add tests in `src/index.test.ts`.
5. Run `pnpm build:ts && pnpm test`.

## Platform Targets

| Target              | Binary                        |
| ------------------- | ----------------------------- |
| macOS Apple Silicon | `rs-pdf.darwin-arm64.node`    |
| macOS Intel         | `rs-pdf.darwin-x64.node`      |
| Linux x64           | `rs-pdf.linux-x64-gnu.node`   |
| Linux ARM64         | `rs-pdf.linux-arm64-gnu.node` |
| Windows x64         | `rs-pdf.win32-x64-msvc.node`  |
