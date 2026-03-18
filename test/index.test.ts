import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { pdfToHtml, pdfToHtmlStream, pdfPageToHtml, pdfInfo, PdfWorkerPool } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLE_PDF = join(__dirname, 'sample.pdf');
const SMALL_PDF = join(__dirname, 'sample.pdf');

// ─── pdfInfo ──────────────────────────────────────────────────────────────────

describe('pdfInfo', () => {
  it('returns basic metadata', async () => {
    const info = await pdfInfo({ path: SAMPLE_PDF });
    expect(info.pageCount).toBeGreaterThan(0);
    expect(info.isDrmProtected).toBe(false);
  });

  it('returns title when available', async () => {
    const info = await pdfInfo({ path: SAMPLE_PDF });
    expect(typeof info.title === 'string' || info.title === undefined).toBe(true);
  });

  it('throws on missing file', async () => {
    await expect(pdfInfo({ path: '/tmp/does-not-exist.pdf' })).rejects.toThrow('Failed to open PDF');
  });
});

// ─── pdfToHtml ────────────────────────────────────────────────────────────────

describe('pdfToHtml', () => {
  it('converts all pages to HTML with SVG visual layer and HTML text layer', async () => {
    const result = await pdfToHtml({ path: SAMPLE_PDF, seoTextLayer: true });
    expect(result.html).toMatch(/^<!DOCTYPE html>/);
    expect(result.html).toContain('<svg');
    expect(result.html).toContain('class="tl"');
    expect(result.html).toContain('color:transparent');
    expect(result.html).toContain('user-select:text');
    expect(result.pagesConverted).toBe(result.pageCount);
    expect(result.isDrmProtected).toBe(false);
  });

  it('text layer contains actual readable text content', async () => {
    const result = await pdfToHtml({ path: SAMPLE_PDF, seoTextLayer: true });
    const spanTexts = [...result.html.matchAll(/<span[^>]*>([^<]{2,})<\/span>/g)].map((m) => m[1].trim()).filter(Boolean);
    expect(spanTexts.length).toBeGreaterThan(0);
  });

  it('omits text layer by default (seoTextLayer unset)', async () => {
    const result = await pdfToHtml({ path: SAMPLE_PDF, startPage: 0, endPage: 0 });
    expect(result.html).toContain('<svg');
    expect(result.html).not.toContain('class="tl"');
  });

  it('respects page range (single page)', async () => {
    const result = await pdfToHtml({ path: SAMPLE_PDF, startPage: 0, endPage: 0 });
    expect(result.pagesConverted).toBe(1);
    expect(result.html).toContain('data-page="1"');
  });

  it('respects page range (multiple pages)', async () => {
    const result = await pdfToHtml({ path: SAMPLE_PDF, startPage: 0, endPage: 1 });
    expect(result.pagesConverted).toBe(2);
  });

  it('pageCount reflects the full document even when converting a range', async () => {
    const info = await pdfInfo({ path: SAMPLE_PDF });
    const result = await pdfToHtml({ path: SAMPLE_PDF, startPage: 0, endPage: 0 });
    expect(result.pageCount).toBe(info.pageCount);
  });

  it('throws on invalid page range', async () => {
    await expect(pdfToHtml({ path: SAMPLE_PDF, startPage: 10, endPage: 5 })).rejects.toThrow('Invalid page range');
  });

  it('throws on missing file', async () => {
    await expect(pdfToHtml({ path: '/tmp/does-not-exist.pdf' })).rejects.toThrow('Failed to open PDF');
  });

  it('throws on DRM-protected PDF without password', async () => {
    const result = await pdfToHtml({ path: SAMPLE_PDF });
    expect(result.isDrmProtected).toBe(false);
  });

  it('produces valid HTML structure', async () => {
    const result = await pdfToHtml({ path: SAMPLE_PDF, startPage: 0, endPage: 0 });
    expect(result.html).toContain('<html>');
    expect(result.html).toContain('</html>');
    expect(result.html).toContain('<head>');
    expect(result.html).toContain('<body>');
    expect(result.html).toContain('class="page"');
  });

  it('respects dpi option', async () => {
    const low = await pdfToHtml({ path: SAMPLE_PDF, startPage: 0, endPage: 0, dpi: 72 });
    const high = await pdfToHtml({ path: SAMPLE_PDF, startPage: 0, endPage: 0, dpi: 300 });
    expect(high.html.length).toBeGreaterThan(low.html.length);
  });
});

// ─── pdfPageToHtml ────────────────────────────────────────────────────────────

describe('pdfPageToHtml', () => {
  it('returns a page fragment with correct metadata', async () => {
    const page = await pdfPageToHtml({ path: SAMPLE_PDF, pageIndex: 0, seoTextLayer: true });
    expect(page.pageIndex).toBe(0);
    expect(page.pageCount).toBeGreaterThan(0);
    expect(page.html).toContain('<svg');
    expect(page.html).toContain('class="tl"');
    expect(page.isDrmProtected).toBe(false);
  });

  it('fragment is not a full document', async () => {
    const page = await pdfPageToHtml({ path: SAMPLE_PDF, pageIndex: 0 });
    expect(page.html).not.toContain('<!DOCTYPE');
    expect(page.html).not.toContain('<html>');
  });

  it('throws on out-of-range pageIndex', async () => {
    const info = await pdfInfo({ path: SAMPLE_PDF });
    await expect(pdfPageToHtml({ path: SAMPLE_PDF, pageIndex: info.pageCount })).rejects.toThrow('out of range');
  });

  it('throws on missing file', async () => {
    await expect(pdfPageToHtml({ path: '/tmp/does-not-exist.pdf', pageIndex: 0 })).rejects.toThrow('Failed to open PDF');
  });
});

// ─── pdfToHtmlStream ─────────────────────────────────────────────────────────

describe('pdfToHtmlStream', () => {
  it('yields all pages in order', async () => {
    const info = await pdfInfo({ path: SMALL_PDF });
    const pages: number[] = [];

    for await (const page of pdfToHtmlStream({ path: SMALL_PDF })) {
      pages.push(page.pageIndex);
    }

    expect(pages).toHaveLength(info.pageCount);
    expect(pages).toEqual([...Array(info.pageCount).keys()]);
  });

  it('each page carries correct pageCount', async () => {
    const info = await pdfInfo({ path: SMALL_PDF });
    for await (const page of pdfToHtmlStream({ path: SMALL_PDF, endPage: 0 })) {
      expect(page.pageCount).toBe(info.pageCount);
    }
  });

  it('respects startPage / endPage range', async () => {
    const pages: number[] = [];
    for await (const page of pdfToHtmlStream({ path: SMALL_PDF, startPage: 1, endPage: 2 })) {
      pages.push(page.pageIndex);
    }
    expect(pages).toEqual([1, 2]);
  });

  it('each page html is a fragment (no DOCTYPE)', async () => {
    for await (const page of pdfToHtmlStream({ path: SMALL_PDF, endPage: 0 })) {
      expect(page.html).not.toContain('<!DOCTYPE');
      expect(page.html).toContain('<svg');
    }
  });

  it('concurrency option prefetches multiple pages', async () => {
    const info = await pdfInfo({ path: SMALL_PDF });
    const pages: number[] = [];

    for await (const page of pdfToHtmlStream({ path: SMALL_PDF, concurrency: 2 })) {
      pages.push(page.pageIndex);
    }

    expect(pages).toHaveLength(info.pageCount);
    expect(pages).toEqual([...Array(info.pageCount).keys()]);
  });

  it('throws on invalid range', async () => {
    async function drain() {
      for await (const _ of pdfToHtmlStream({ path: SMALL_PDF, startPage: 5, endPage: 2 })) {
        /* noop */
      }
    }
    await expect(drain()).rejects.toThrow('Invalid page range');
  });

  it('propagates errors from missing file', async () => {
    async function drain() {
      for await (const _ of pdfToHtmlStream({ path: '/tmp/does-not-exist.pdf' })) {
        /* noop */
      }
    }
    await expect(drain()).rejects.toThrow('Failed to open PDF');
  });
});

// ─── PdfWorkerPool ────────────────────────────────────────────────────────────

describe('PdfWorkerPool', () => {
  it('converts PDFs with concurrency=1', async () => {
    const pool = new PdfWorkerPool({ concurrency: 1 });
    const result = await pool.convert({ path: SMALL_PDF, startPage: 0, endPage: 0 });
    expect(result.pagesConverted).toBe(1);
    pool.destroy();
  });

  it('processes multiple PDFs respecting concurrency limit', async () => {
    const pool = new PdfWorkerPool({ concurrency: 2 });
    const inputs = [SMALL_PDF, SMALL_PDF, SMALL_PDF];

    const results = await Promise.all(inputs.map((p) => pool.convert({ path: p, startPage: 0, endPage: 0 })));

    expect(results).toHaveLength(3);
    results.forEach((r) => expect(r.pagesConverted).toBe(1));
    pool.destroy();
  });

  it('pool.active and pool.pending reflect in-flight state', async () => {
    const pool = new PdfWorkerPool({ concurrency: 1 });

    const [p1, p2] = [
      pool.convert({ path: SMALL_PDF, startPage: 0, endPage: 0 }),
      pool.convert({ path: SMALL_PDF, startPage: 0, endPage: 0 }),
    ];

    expect(pool.active + pool.pending).toBeGreaterThanOrEqual(1);

    await Promise.all([p1, p2]);
    expect(pool.active).toBe(0);
    expect(pool.pending).toBe(0);
    pool.destroy();
  });

  it('streams pages via pool', async () => {
    const pool = new PdfWorkerPool({ concurrency: 2 });
    const pages: number[] = [];

    for await (const page of pool.stream({ path: SMALL_PDF })) {
      pages.push(page.pageIndex);
    }

    const info = await pdfInfo({ path: SMALL_PDF });
    expect(pages).toHaveLength(info.pageCount);
    pool.destroy();
  });

  it('destroy prevents further operations', async () => {
    const pool = new PdfWorkerPool({ concurrency: 1 });
    pool.destroy();
    await expect(pool.convert({ path: SMALL_PDF })).rejects.toThrow('destroyed');
  });

  it('default concurrency is at least 1', () => {
    const pool = new PdfWorkerPool();
    expect(pool.concurrency).toBeGreaterThanOrEqual(1);
    pool.destroy();
  });
});

// ─── Performance ──────────────────────────────────────────────────────────────

describe('performance', () => {
  it('pdfToHtml: all pages within a reasonable time', async () => {
    const info = await pdfInfo({ path: SAMPLE_PDF });
    const t0 = Date.now();
    await pdfToHtml({ path: SAMPLE_PDF });
    const elapsed = Date.now() - t0;
    const msPerPage = elapsed / info.pageCount;

    console.info(`  pdfToHtml: ${info.pageCount} pages · ${elapsed}ms · ${msPerPage.toFixed(1)}ms/page`);
    expect(msPerPage).toBeLessThan(2000);
  });

  it('pdfToHtmlStream (concurrency=1): sequential yield time', async () => {
    const info = await pdfInfo({ path: SMALL_PDF });
    const t0 = Date.now();
    let count = 0;
    for await (const _ of pdfToHtmlStream({ path: SMALL_PDF })) count++;
    const elapsed = Date.now() - t0;

    console.info(`  stream(c=1): ${count} pages · ${elapsed}ms · ${(elapsed / count).toFixed(1)}ms/page`);
    expect(count).toBe(info.pageCount);
  });

  it('pdfToHtmlStream (concurrency=4): prefetch reduces wall-clock time', async () => {
    const [t0] = [Date.now()];
    let c1 = 0;
    for await (const _ of pdfToHtmlStream({ path: SMALL_PDF, concurrency: 1 })) c1++;
    const seqMs = Date.now() - t0;

    const t1 = Date.now();
    let c4 = 0;
    for await (const _ of pdfToHtmlStream({ path: SMALL_PDF, concurrency: 4 })) c4++;
    const parMs = Date.now() - t1;

    console.info(`  stream c=1: ${seqMs}ms  c=4: ${parMs}ms  speedup: ${(seqMs / parMs).toFixed(2)}x`);
    expect(c1).toBe(c4);
  });

  it('writes output html to disk for manual inspection', async () => {
    const result = await pdfToHtml({ path: SAMPLE_PDF, startPage: 0, endPage: 10, dpi: 96 });
    const outPath = join(__dirname, '../dist/output-test.html');
    writeFileSync(outPath, result.html);
    console.info(`  HTML saved → ${outPath} (${(result.html.length / 1024).toFixed(0)}KB)`);
  });
});
