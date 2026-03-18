import { createRequire } from 'node:module';
import { cpus } from 'node:os';
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
} from './types.js';
import type {
  PdfConvertOptions,
  PdfConvertResult,
  PdfPageResult,
  PdfInfo,
  PdfStreamOptions,
  PdfWorkerPoolOptions,
} from './types.js';

// ─── Native binding loader ────────────────────────────────────────────────────

const PLATFORM_FILENAMES: Record<string, string> = {
  'darwin arm64': 'rs-pdf.darwin-arm64.node',
  'darwin x64': 'rs-pdf.darwin-x64.node',
  'linux x64': 'rs-pdf.linux-x64-gnu.node',
  'linux arm64': 'rs-pdf.linux-arm64-gnu.node',
  'win32 x64': 'rs-pdf.win32-x64-msvc.node',
};

// Optional-dependency package names (used when installed via npm)
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

  // 1. Installed as optionalDependency (npm publish scenario)
  if (pkg) {
    try {
      candidates.push(_require.resolve(`${pkg}/${filename}`));
    } catch {
      /* not installed */
    }
  }

  // 2. Local dist/ (same dir as this compiled file, or ../dist from src/)
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

// ─── Core API ─────────────────────────────────────────────────────────────────

/**
 * Convert a PDF file to a self-contained HTML document.
 *
 * All pages are converted before the promise resolves. For large PDFs or when
 * you want to process pages as they arrive, use {@link pdfToHtmlStream} instead.
 *
 * @example
 * const result = await pdfToHtml('/path/to/file.pdf')
 * const result = await pdfToHtml('/path/to/file.pdf', { startPage: 0, endPage: 9 })
 * const result = await pdfToHtml('/path/to/protected.pdf', { password: 'secret' })
 */
export function pdfToHtml(path: string, options?: PdfConvertOptions): Promise<PdfConvertResult> {
  return binding.pdfToHtml(path, options);
}

/**
 * Convert a single page of a PDF to an HTML fragment.
 *
 * The returned `html` is a page fragment, not a full document - it has no
 * DOCTYPE, html, head, or body tags. Use this when you need fine-grained
 * control over individual pages.
 *
 * @param pageIndex - 0-based page index
 */
export function pdfPageToHtml(path: string, pageIndex: number, options?: PdfConvertOptions): Promise<PdfPageResult> {
  return binding.pdfPageToHtml(path, pageIndex, options);
}

/**
 * Get PDF metadata without converting it.
 * Safe to call on DRM-protected PDFs - returns `isDrmProtected: true` without throwing.
 */
export function pdfInfo(path: string, password?: string): Promise<PdfInfo> {
  return binding.pdfInfo(path, password);
}

// ─── Streaming API ────────────────────────────────────────────────────────────

/**
 * Convert a PDF to HTML page-by-page as an async generator.
 *
 * Each yielded value is a {@link PdfPageResult} containing the HTML fragment
 * for that page. Pages are yielded in order, starting from `startPage`.
 *
 * Use the `concurrency` option to prefetch multiple pages in parallel,
 * reducing total wall-clock time for large PDFs at the cost of buffering
 * more pages in memory simultaneously.
 *
 * @example
 * // Process pages one at a time as they arrive
 * for await (const page of pdfToHtmlStream('/large.pdf')) {
 *   console.log(`Page ${page.pageIndex + 1}/${page.pageCount}: ${page.html.length} bytes`)
 *   await saveToDatabase(page)
 * }
 *
 * @example
 * // Prefetch up to 4 pages at a time
 * for await (const page of pdfToHtmlStream('/large.pdf', { concurrency: 4 })) {
 *   process(page)
 * }
 */
export async function* pdfToHtmlStream(path: string, options?: PdfStreamOptions): AsyncGenerator<PdfPageResult> {
  const { concurrency = 1, startPage, endPage, ...pageOpts } = options ?? {};

  const info = await binding.pdfInfo(path, pageOpts.password);
  const start = startPage ?? 0;
  const end = Math.min(endPage ?? info.pageCount - 1, info.pageCount - 1);

  if (start > end) {
    throw new Error(`Invalid page range: startPage (${start}) > endPage (${end})`);
  }

  const window = Math.max(1, concurrency);

  // Sliding window of in-flight promises - gives backpressure-aware prefetch.
  // At any point there are at most `window` pages being converted concurrently.
  const queue: Promise<PdfPageResult>[] = [];
  let nextFetch = start;

  // Prime the window
  while (queue.length < window && nextFetch <= end) {
    queue.push(binding.pdfPageToHtml(path, nextFetch++, pageOpts));
  }

  while (queue.length > 0) {
    const result = await queue.shift()!;
    // Immediately kick off the next page while the caller processes the current one
    if (nextFetch <= end) {
      queue.push(binding.pdfPageToHtml(path, nextFetch++, pageOpts));
    }
    yield result;
  }
}

// ─── Worker Pool ──────────────────────────────────────────────────────────────

/**
 * A concurrency-limited pool for converting multiple PDFs in parallel.
 *
 * Limits how many PDFs are being actively converted at once, preventing OOM
 * from unbounded parallelism when processing large batches.
 *
 * The underlying `pdfToHtml`/`pdfToHtmlStream` already run on Tokio's blocking
 * thread pool and never block the Node.js event loop - the pool controls
 * how many are in-flight simultaneously at the JavaScript level.
 *
 * @example
 * const pool = new PdfWorkerPool({ concurrency: 4 })
 *
 * // Batch convert
 * const results = await Promise.all(
 *   pdfPaths.map(p => pool.convert(p))
 * )
 *
 * // Stream from pool
 * for await (const page of pool.stream('/large.pdf')) {
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
      next(); // hand the slot directly - running count stays the same
    } else {
      this._running--;
    }
  }

  /**
   * Convert a PDF, waiting for a pool slot if all are busy.
   * Equivalent to `pdfToHtml` but concurrency-limited.
   */
  async convert(path: string, options?: PdfConvertOptions): Promise<PdfConvertResult> {
    await this._acquire();
    try {
      return await binding.pdfToHtml(path, options);
    } finally {
      this._release();
    }
  }

  /**
   * Stream a PDF page-by-page, holding a pool slot for the entire duration.
   * Equivalent to `pdfToHtmlStream` but concurrency-limited.
   */
  async *stream(path: string, options?: PdfStreamOptions): AsyncGenerator<PdfPageResult> {
    await this._acquire();
    try {
      yield* pdfToHtmlStream(path, options);
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
