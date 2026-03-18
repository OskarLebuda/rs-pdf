import { createRequire } from 'node:module';
import { cpus, tmpdir } from 'node:os';
import { writeFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const _require = createRequire(import.meta.url);

export type {
  PdfConvertOptions,
  PdfConvertResult,
  PdfPageResult,
  PdfInfo,
  PdfStreamOptions,
  PdfWorkerPoolOptions,
  PdfSource,
  PdfInfoInput,
  PdfToHtmlInput,
  PdfPageToHtmlInput,
  PdfStreamInput,
} from './types.js';
import type {
  PdfConvertOptions,
  PdfConvertResult,
  PdfPageResult,
  PdfInfo,
  PdfStreamOptions,
  PdfWorkerPoolOptions,
  PdfSource,
  PdfInfoInput,
  PdfToHtmlInput,
  PdfPageToHtmlInput,
  PdfStreamInput,
} from './types.js';

// ─── Native binding loader ────────────────────────────────────────────────────

const PLATFORM_FILENAMES: Record<string, string> = {
  'darwin arm64': 'rs-pdf.darwin-arm64.node',
  'darwin x64': 'rs-pdf.darwin-x64.node',
  'linux x64': 'rs-pdf.linux-x64-gnu.node',
  'linux arm64': 'rs-pdf.linux-arm64-gnu.node',
  'win32 x64': 'rs-pdf.win32-x64-msvc.node',
};

const PLATFORM_PACKAGES: Record<string, string> = {
  'darwin arm64': '@rs-pdf/darwin-arm64',
  'darwin x64': '@rs-pdf/darwin-x64',
  'linux x64': '@rs-pdf/linux-x64-gnu',
  'linux arm64': '@rs-pdf/linux-arm64-gnu',
  'win32 x64': '@rs-pdf/win32-x64-msvc',
};

interface NativeBinding {
  pdfToHtml: (path: string, options?: PdfConvertOptions) => Promise<PdfConvertResult>;
  pdfPageToHtml: (path: string, pageIndex: number, options?: PdfConvertOptions) => Promise<PdfPageResult>;
  pdfInfo: (path: string, password?: string) => Promise<PdfInfo>;
}

function loadBinding(): NativeBinding {
  const key = `${process.platform} ${process.arch}`;
  const filename = PLATFORM_FILENAMES[key];
  const pkg = PLATFORM_PACKAGES[key];

  if (!filename) throw new Error(`@rs-pdf/core: unsupported platform "${key}"`);

  const candidates: string[] = [];

  if (pkg) {
    try {
      candidates.push(_require.resolve(`${pkg}/${filename}`));
    } catch {
      /* not installed */
    }
  }

  candidates.push(join(__dirname, filename), join(__dirname, '..', 'dist', filename));

  for (const candidate of candidates) {
    try {
      return _require(candidate) as NativeBinding;
    } catch {
      /* try next */
    }
  }

  throw new Error(
    `@rs-pdf/core: could not find native binding "${filename}".\n` +
      `  Tried: ${candidates.join(', ')}\n` +
      `  Run \`pnpm build:native\` to compile it.`,
  );
}

const binding = loadBinding();

// ─── URL download helper ──────────────────────────────────────────────────────

async function resolveSource(src: PdfSource): Promise<{ path: string; cleanup: () => Promise<void> }> {
  if (src.url !== undefined) {
    const res = await fetch(src.url);
    if (!res.ok) {
      throw new Error(`@rs-pdf/core: failed to fetch "${src.url}": ${res.status} ${res.statusText}`);
    }
    const buffer = await res.arrayBuffer();
    const tmpPath = join(tmpdir(), `rs-pdf-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
    await writeFile(tmpPath, Buffer.from(buffer));
    return { path: tmpPath, cleanup: () => unlink(tmpPath).catch(() => {}) };
  }
  return { path: src.path, cleanup: () => Promise.resolve() };
}

// ─── Core API ─────────────────────────────────────────────────────────────────

/**
 * Convert a PDF to a self-contained HTML document.
 *
 * Accepts either a local file `path` or a remote `url`.
 * All pages are converted before the promise resolves. For large PDFs or when
 * you want to process pages as they arrive, use {@link pdfToHtmlStream} instead.
 *
 * @example
 * const result = await pdfToHtml({ path: '/path/to/file.pdf' })
 * const result = await pdfToHtml({ url: 'https://example.com/doc.pdf', dpi: 200 })
 * const result = await pdfToHtml({ path: '/protected.pdf', password: 'secret' })
 */
export async function pdfToHtml(input: PdfToHtmlInput): Promise<PdfConvertResult> {
  const { path: _p, url: _u, ...options } = input as any;
  const { path, cleanup } = await resolveSource(input);
  try {
    return await binding.pdfToHtml(path, options);
  } finally {
    await cleanup();
  }
}

/**
 * Convert a single page of a PDF to an HTML fragment.
 *
 * The returned `html` is a page fragment — no DOCTYPE, html, head, or body tags.
 * Accepts either a local file `path` or a remote `url`.
 *
 * @example
 * const page = await pdfPageToHtml({ path: '/file.pdf', pageIndex: 3 })
 * const page = await pdfPageToHtml({ url: 'https://example.com/doc.pdf', pageIndex: 0 })
 */
export async function pdfPageToHtml(input: PdfPageToHtmlInput): Promise<PdfPageResult> {
  const { path: _p, url: _u, pageIndex, ...options } = input as any;
  const { path, cleanup } = await resolveSource(input);
  try {
    return await binding.pdfPageToHtml(path, pageIndex, options);
  } finally {
    await cleanup();
  }
}

/**
 * Get PDF metadata without converting it.
 * Safe to call on DRM-protected PDFs — returns `isDrmProtected: true` without throwing.
 * Accepts either a local file `path` or a remote `url`.
 *
 * @example
 * const info = await pdfInfo({ path: '/file.pdf' })
 * const info = await pdfInfo({ url: 'https://example.com/doc.pdf' })
 */
export async function pdfInfo(input: PdfInfoInput): Promise<PdfInfo> {
  const { password } = input;
  const { path, cleanup } = await resolveSource(input);
  try {
    return await binding.pdfInfo(path, password);
  } finally {
    await cleanup();
  }
}

// ─── Streaming API ────────────────────────────────────────────────────────────

/**
 * Convert a PDF to HTML page-by-page as an async generator.
 *
 * Accepts either a local file `path` or a remote `url`.
 * Each yielded value is a {@link PdfPageResult} containing the HTML fragment
 * for that page. Pages are yielded in order, starting from `startPage`.
 *
 * @example
 * for await (const page of pdfToHtmlStream({ path: '/large.pdf' })) {
 *   console.log(`Page ${page.pageIndex + 1}/${page.pageCount}`)
 * }
 *
 * @example
 * for await (const page of pdfToHtmlStream({ url: 'https://example.com/doc.pdf', concurrency: 4 })) {
 *   process(page)
 * }
 */
export async function* pdfToHtmlStream(input: PdfStreamInput): AsyncGenerator<PdfPageResult> {
  const { concurrency = 1, startPage, endPage, ...pageOpts } = input as PdfStreamOptions;
  const { path, cleanup } = await resolveSource(input);

  try {
    const info = await binding.pdfInfo(path, pageOpts.password);
    const start = startPage ?? 0;
    const end = Math.min(endPage ?? info.pageCount - 1, info.pageCount - 1);

    if (start > end) {
      throw new Error(`Invalid page range: startPage (${start}) > endPage (${end})`);
    }

    const window = Math.max(1, concurrency);
    const queue: Promise<PdfPageResult>[] = [];
    let nextFetch = start;

    while (queue.length < window && nextFetch <= end) {
      queue.push(binding.pdfPageToHtml(path, nextFetch++, pageOpts));
    }

    while (queue.length > 0) {
      const result = await queue.shift()!;
      if (nextFetch <= end) {
        queue.push(binding.pdfPageToHtml(path, nextFetch++, pageOpts));
      }
      yield result;
    }
  } finally {
    await cleanup();
  }
}

// ─── Worker Pool ──────────────────────────────────────────────────────────────

/**
 * A concurrency-limited pool for converting multiple PDFs in parallel.
 *
 * Limits how many PDFs are being actively converted at once, preventing OOM
 * from unbounded parallelism when processing large batches.
 *
 * @example
 * const pool = new PdfWorkerPool({ concurrency: 4 })
 *
 * const results = await Promise.all(
 *   pdfPaths.map(p => pool.convert({ path: p }))
 * )
 *
 * for await (const page of pool.stream({ url: 'https://example.com/doc.pdf' })) {
 *   process(page)
 * }
 *
 * pool.destroy()
 */
export class PdfWorkerPool {
  private readonly _concurrency: number;
  private _running = 0;
  private readonly _queue: Array<() => void> = [];
  private _destroyed = false;

  constructor(options: PdfWorkerPoolOptions = {}) {
    this._concurrency = options.concurrency ?? Math.max(1, cpus().length - 1);
  }

  /** Maximum concurrent operations */
  get concurrency(): number {
    return this._concurrency;
  }
  /** Currently active operations */
  get active(): number {
    return this._running;
  }
  /** Operations waiting for a slot */
  get pending(): number {
    return this._queue.length;
  }

  private _acquire(): Promise<void> {
    if (this._destroyed) throw new Error('PdfWorkerPool has been destroyed');
    if (this._running < this._concurrency) {
      this._running++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this._queue.push(resolve));
  }

  private _release(): void {
    const next = this._queue.shift();
    if (next) {
      next();
    } else {
      this._running--;
    }
  }

  /**
   * Convert a PDF, waiting for a pool slot if all are busy.
   * Equivalent to `pdfToHtml` but concurrency-limited.
   */
  async convert(input: PdfToHtmlInput): Promise<PdfConvertResult> {
    await this._acquire();
    try {
      return await pdfToHtml(input);
    } finally {
      this._release();
    }
  }

  /**
   * Stream a PDF page-by-page, holding a pool slot for the entire duration.
   * Equivalent to `pdfToHtmlStream` but concurrency-limited.
   */
  async *stream(input: PdfStreamInput): AsyncGenerator<PdfPageResult> {
    await this._acquire();
    try {
      yield* pdfToHtmlStream(input);
    } finally {
      this._release();
    }
  }

  /**
   * Mark the pool as destroyed. Subsequent calls to `convert`/`stream` will throw.
   * Does not cancel in-flight operations.
   */
  destroy(): void {
    this._destroyed = true;
  }
}
