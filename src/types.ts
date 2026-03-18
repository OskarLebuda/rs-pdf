export interface PdfConvertOptions {
  /** First page to convert (0-based). Default: 0 */
  startPage?: number;
  /** Last page to convert (0-based, inclusive). Default: last page */
  endPage?: number;
  /** Password for DRM-protected PDFs */
  password?: string;
  /** DPI for rendering quality. Default: 150 */
  dpi?: number;
  /**
   * Add a transparent HTML text layer on top of the SVG for SEO / crawler indexing.
   * Invisible to users but readable by search engines and copy-pasteable.
   * Default: false
   */
  seoTextLayer?: boolean;
}

export interface PdfConvertResult {
  /** Self-contained HTML document with SVG visual layer + transparent text layer */
  html: string;
  /** Total number of pages in the document */
  pageCount: number;
  /** Whether the PDF was DRM-protected */
  isDrmProtected: boolean;
  /** Number of pages actually converted */
  pagesConverted: number;
}

export interface PdfPageResult {
  /** 0-based index of this page */
  pageIndex: number;
  /** Total pages in the document */
  pageCount: number;
  /** HTML fragment for this page (not a full document) */
  html: string;
  isDrmProtected: boolean;
}

export interface PdfInfo {
  pageCount: number;
  isDrmProtected: boolean;
  title?: string;
  author?: string;
  subject?: string;
  creator?: string;
}

export interface PdfStreamOptions extends PdfConvertOptions {
  /**
   * How many pages to fetch ahead concurrently.
   * Default: 1 (sequential). Higher values reduce wall-clock time for
   * large PDFs at the cost of more memory in use simultaneously.
   */
  concurrency?: number;
}

export interface PdfWorkerPoolOptions {
  /**
   * Maximum number of PDFs to convert concurrently.
   * Default: logical CPU count − 1 (min 1).
   */
  concurrency?: number;
}

// ─── Input types ─────────────────────────────────────────────────────────────

/**
 * PDF source — provide either a local file `path` or a remote `url`, not both.
 * When `url` is given the file is downloaded to a temporary location and
 * cleaned up automatically after the operation completes.
 */
export type PdfSource =
  | { path: string; url?: never }
  | { url: string; path?: never };

/** Input for {@link pdfInfo} */
export type PdfInfoInput = PdfSource & { password?: string };

/** Input for {@link pdfToHtml} */
export type PdfToHtmlInput = PdfSource & PdfConvertOptions & {
  /**
   * Write the HTML output directly to this file path.
   * When set, `result.html` is an empty string — the content goes to disk only.
   * Parent directories are created automatically.
   */
  outputPath?: string;
};

/** Input for {@link pdfPageToHtml} */
export type PdfPageToHtmlInput = PdfSource & { pageIndex: number } & PdfConvertOptions;

/** Input for {@link pdfToHtmlStream} */
export type PdfStreamInput = PdfSource & PdfStreamOptions;
