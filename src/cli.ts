#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { stdout, stderr, exit } from 'node:process';
import { pdfToHtml, pdfPageToHtml, pdfInfo } from './index.js';

const HELP = `
Usage:
  rs-pdf [options] <path|url>        Convert PDF to HTML
  rs-pdf info [options] <path|url>   Print PDF metadata

Options:
  -o, --output <file>     Write HTML to file (default: stdout)
  --start-page <n>        First page, 0-based (default: 0)
  --end-page <n>          Last page, 0-based (default: last)
  --page <n>              Convert single page, 0-based
  --dpi <n>               Render DPI (default: 150)
  --seo-text-layer        Add transparent text layer for SEO / copy-paste
  --password <str>        Password for DRM-protected PDFs
  -h, --help              Show this help

Examples:
  rs-pdf document.pdf -o output.html
  rs-pdf document.pdf --start-page 0 --end-page 9 --dpi 200 -o out.html
  rs-pdf document.pdf --page 3 -o page3.html
  rs-pdf https://example.com/doc.pdf -o output.html
  rs-pdf info document.pdf
`.trim();

let parsed: ReturnType<typeof parseArgs>;
try {
  parsed = parseArgs({
    options: {
      output:           { type: 'string',  short: 'o' },
      'start-page':     { type: 'string' },
      'end-page':       { type: 'string' },
      page:             { type: 'string' },
      dpi:              { type: 'string' },
      'seo-text-layer': { type: 'boolean' },
      password:         { type: 'string' },
      help:             { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
    strict: true,
  });
} catch (err: any) {
  stderr.write(`Error: ${err.message}\n\nRun with --help for usage.\n`);
  exit(1);
}

const { values, positionals } = parsed;

if (values.help) {
  stdout.write(HELP + '\n');
  exit(0);
}

const isInfo = positionals[0] === 'info';
const inputArg = isInfo ? positionals[1] : positionals[0];

if (!inputArg) {
  stderr.write('Error: no input file or URL provided.\n\nRun with --help for usage.\n');
  exit(1);
}

const source =
  inputArg.startsWith('http://') || inputArg.startsWith('https://')
    ? { url: inputArg }
    : { path: resolve(inputArg) };

async function run() {
  if (isInfo) {
    const info = await pdfInfo({ ...source, password: values.password });
    stdout.write(JSON.stringify(info, null, 2) + '\n');
    return;
  }

  const opts = {
    startPage:    values['start-page']   !== undefined ? parseInt(values['start-page']!, 10)  : undefined,
    endPage:      values['end-page']     !== undefined ? parseInt(values['end-page']!, 10)    : undefined,
    dpi:          values.dpi             !== undefined ? parseInt(values.dpi!, 10)             : undefined,
    seoTextLayer: values['seo-text-layer'],
    password:     values.password,
  };

  const outFile = values.output ? resolve(values.output) : null;

  if (values.page !== undefined) {
    const page = await pdfPageToHtml({
      ...source,
      pageIndex: parseInt(values.page!, 10),
      ...opts,
    });
    await output(outFile, page.html);
    progress(`Page ${page.pageIndex + 1}/${page.pageCount} converted`);
    return;
  }

  if (outFile) {
    const result = await pdfToHtml({ ...source, ...opts, outputPath: outFile });
    progress(`Converted ${result.pagesConverted}/${result.pageCount} pages → ${outFile}`);
  } else {
    const result = await pdfToHtml({ ...source, ...opts });
    stdout.write(result.html);
    progress(`Converted ${result.pagesConverted}/${result.pageCount} pages`);
  }
}

async function output(filePath: string | null, html: string) {
  if (filePath) {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, html, 'utf8');
  } else {
    stdout.write(html);
  }
}

function progress(msg: string) {
  // Only print to stderr so stdout stays clean for pipe usage
  if (values.output || values.page !== undefined || positionals[0] === 'info') {
    stderr.write(msg + '\n');
  }
}

run().catch((err: Error) => {
  stderr.write(`Error: ${err.message}\n`);
  exit(1);
});
