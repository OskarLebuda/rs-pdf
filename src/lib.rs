#![deny(clippy::all)]

use mupdf::{Document, Matrix, MetadataName, TextPageFlags};
use napi::bindgen_prelude::*;
use napi_derive::napi;

/// Options for PDF conversion
#[napi(object)]
pub struct PdfConvertOptions {
    /// First page to convert (0-based). Default: 0
    pub start_page: Option<u32>,
    /// Last page to convert (0-based, inclusive). Default: last page
    pub end_page: Option<u32>,
    /// Password for DRM-protected PDFs
    pub password: Option<String>,
    /// DPI for SVG rendering quality. Default: 150
    pub dpi: Option<u32>,
    /// Add a transparent HTML text layer on top of the SVG for SEO / crawler indexing.
    /// The layer is invisible to users but fully readable by search engines.
    /// Default: false
    pub seo_text_layer: Option<bool>,
}

/// Result of PDF conversion
#[napi(object)]
pub struct PdfConvertResult {
    /// Self-contained HTML: SVG visual layer + transparent HTML text layer (SEO-ready)
    pub html: String,
    /// Total number of pages in the document
    pub page_count: u32,
    /// Whether the PDF was DRM-protected
    pub is_drm_protected: bool,
    /// Number of pages actually converted
    pub pages_converted: u32,
}

/// PDF metadata
#[napi(object)]
pub struct PdfInfo {
    pub page_count: u32,
    pub is_drm_protected: bool,
    pub title: Option<String>,
    pub author: Option<String>,
    pub subject: Option<String>,
    pub creator: Option<String>,
}

fn open_and_auth(path: &str, password: Option<&str>) -> Result<(Document, bool)> {
    let mut doc = Document::open(path).map_err(|e| {
        Error::new(Status::GenericFailure, format!("Failed to open PDF: {}", e))
    })?;

    let is_drm = doc.needs_password().map_err(|e| {
        Error::new(Status::GenericFailure, format!("Failed to check password requirement: {}", e))
    })?;

    if is_drm {
        match password {
            Some(pwd) => {
                let ok = doc.authenticate(pwd).map_err(|e| {
                    Error::new(Status::GenericFailure, format!("Authentication error: {}", e))
                })?;
                if !ok {
                    return Err(Error::new(
                        Status::GenericFailure,
                        "Invalid password for DRM-protected PDF",
                    ));
                }
            }
            None => {
                return Err(Error::new(
                    Status::GenericFailure,
                    "PDF is DRM-protected. Provide a password via options.password",
                ));
            }
        }
    }

    Ok((doc, is_drm))
}

fn metadata_opt(doc: &Document, name: MetadataName) -> Option<String> {
    doc.metadata(name).ok().filter(|s| !s.is_empty())
}

/// Render a single page as SVG, optionally with an HTML text layer for SEO.
///
/// Returns a tuple of (page_index, page_html_fragment).
///
/// When `seo_text_layer` is true the output has two layers:
///   - SVG: pixel-perfect visual render (text as vector paths)
///   - `.tl` div: absolute-positioned HTML text overlay, `color:transparent!important`
///     → invisible to users, indexed by crawlers, copy-pasteable
fn convert_page(doc: &Document, page_index: i32, scale: f32, seo_text_layer: bool) -> Result<(i32, String)> {
    let page = doc.load_page(page_index).map_err(|e| {
        Error::new(
            Status::GenericFailure,
            format!("Failed to load page {}: {}", page_index + 1, e),
        )
    })?;

    // Page bounds in PDF points (1pt = 1/72 inch)
    let bounds = page.bounds().map_err(|e| {
        Error::new(
            Status::GenericFailure,
            format!("Failed to get bounds for page {}: {}", page_index + 1, e),
        )
    })?;
    let pt_w = bounds.x1 - bounds.x0;
    let pt_h = bounds.y1 - bounds.y0;
    let px_w = pt_w * scale;
    let px_h = pt_h * scale;

    // Visual layer: SVG (text rendered as vector paths for pixel-perfect fidelity)
    let ctm = Matrix::new_scale(scale, scale);
    let svg = page.to_svg(&ctm).map_err(|e| {
        Error::new(
            Status::GenericFailure,
            format!("Failed to render page {} to SVG: {}", page_index + 1, e),
        )
    })?;

    // Without SEO text layer: return a simple SVG-only wrapper
    if !seo_text_layer {
        let fragment = format!(
            "<div style=\"position:relative;width:{px_w:.1}px;height:{px_h:.1}px;overflow:hidden;\">{svg}</div>",
            px_w = px_w,
            px_h = px_h,
            svg = svg,
        );
        return Ok((page_index, fragment));
    }

    // Text layer: MuPDF structured HTML output in PDF point coordinates.
    // `to_html(id, full=false)` returns an HTML fragment with absolute-positioned
    // <p> and <span> elements using the original PDF point coordinate system.
    let text_page = page
        .to_text_page(TextPageFlags::DEHYPHENATE | TextPageFlags::PRESERVE_WHITESPACE)
        .map_err(|e| {
            Error::new(
                Status::GenericFailure,
                format!("Failed to extract text from page {}: {}", page_index + 1, e),
            )
        })?;

    let text_html = text_page.to_html(page_index, false).map_err(|e| {
        Error::new(
            Status::GenericFailure,
            format!("Failed to convert text to HTML for page {}: {}", page_index + 1, e),
        )
    })?;

    // Combined page: relative container → SVG visual + scaled text overlay
    //
    // The text layer is in PDF point space (pt_w × pt_h pixels at 72dpi).
    // CSS transform:scale(scale) expands it to match the SVG rendered at `dpi`.
    // transform-origin: top left ensures alignment.
    let fragment = format!(
        concat!(
            "<div style=\"position:relative;width:{px_w:.1}px;height:{px_h:.1}px;overflow:hidden;\">",
            // Visual layer
            "{svg}",
            // SEO text layer: transparent overlay, crawlable, copy-pasteable
            "<div class=\"tl\" style=\"",
            "position:absolute;top:0;left:0;",
            "width:{pt_w:.1}px;height:{pt_h:.1}px;",
            "transform:scale({scale:.6});transform-origin:top left;",
            "color:transparent;",    // invisible to users
            "user-select:text;",     // copy-pasteable
            "pointer-events:none;",  // don't block SVG interactions
            "overflow:hidden;",
            "\">",
            "{text_html}",
            "</div>",
            "</div>"
        ),
        px_w = px_w,
        px_h = px_h,
        svg = svg,
        pt_w = pt_w,
        pt_h = pt_h,
        scale = scale,
        text_html = text_html,
    );

    Ok((page_index, fragment))
}

fn build_html(pages: Vec<(i32, String)>, total_pages: i32) -> String {
    let body_cap: usize = pages.iter().map(|(_, s)| s.len() + 128).sum();
    let mut html = String::with_capacity(body_cap + 2048);

    html.push_str(concat!(
        "<!DOCTYPE html>\n",
        "<html>\n<head>\n",
        "<meta charset=\"UTF-8\">\n",
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n",
        "<style>\n",
        "body{margin:0;padding:0;background:#525659;}\n",
        // Page wrapper: centers the rendered page horizontally
        ".page{display:block;margin:16px auto;box-shadow:0 2px 8px rgba(0,0,0,.4);background:#fff;overflow:hidden;}\n",
        // SVG fills its container
        ".page svg{display:block;}\n",
        // Text layer: force ALL text transparent — overrides any inline color from MuPDF output
        ".tl,.tl *{color:transparent!important;background:transparent!important;}\n",
        // Text layer paragraphs — MuPDF outputs absolute-positioned <p> elements
        ".tl p{margin:0;white-space:pre;}\n",
        ".tl span{display:inline-block;}\n",
        "</style>\n</head>\n<body>\n",
    ));

    for (i, content) in pages {
        html.push_str(&format!(
            "<div class=\"page\" id=\"page-{}\" data-page=\"{}\" data-total=\"{}\">\n",
            i + 1,
            i + 1,
            total_pages
        ));
        html.push_str(&content);
        html.push_str("\n</div>\n");
    }

    html.push_str("</body>\n</html>");
    html
}

/// Convert a PDF file to a self-contained HTML document.
///
/// Each page has two layers:
/// 1. SVG — pixel-perfect visual rendering (text as vector paths)
/// 2. Transparent HTML text layer — exact text content from PDF, invisible to users
///    but fully readable by search engine crawlers. Users can also copy-paste from it.
///
/// @param path - Path to the PDF file
/// @param options - Conversion options (page range, password, DPI)
#[napi]
pub async fn pdf_to_html(
    path: String,
    options: Option<PdfConvertOptions>,
) -> Result<PdfConvertResult> {
    tokio::task::spawn_blocking(move || -> Result<PdfConvertResult> {
        let opts = options.unwrap_or(PdfConvertOptions {
            start_page: None,
            end_page: None,
            password: None,
            dpi: None,
            seo_text_layer: None,
        });

        let dpi = opts.dpi.unwrap_or(150);
        let scale = dpi as f32 / 72.0;

        let (doc, is_drm) = open_and_auth(&path, opts.password.as_deref())?;

        let total = doc.page_count().map_err(|e| {
            Error::new(
                Status::GenericFailure,
                format!("Failed to get page count: {}", e),
            )
        })? as u32;

        let start = opts.start_page.unwrap_or(0) as i32;
        let end = opts
            .end_page
            .map(|p| p as i32)
            .unwrap_or(total as i32 - 1)
            .min(total as i32 - 1);

        if start > end || start < 0 {
            return Err(Error::new(
                Status::InvalidArg,
                format!(
                    "Invalid page range: start={} end={} (total={})",
                    start, end, total
                ),
            ));
        }

        let seo_text_layer = opts.seo_text_layer.unwrap_or(false);
        let mut pages = Vec::with_capacity((end - start + 1) as usize);
        for i in start..=end {
            pages.push(convert_page(&doc, i, scale, seo_text_layer)?);
        }

        let pages_converted = pages.len() as u32;
        let html = build_html(pages, total as i32);

        Ok(PdfConvertResult {
            html,
            page_count: total,
            is_drm_protected: is_drm,
            pages_converted,
        })
    })
    .await
    .map_err(|e| Error::new(Status::GenericFailure, format!("Task panicked: {}", e)))?
}

/// Result of a single-page conversion (used by pdfToHtmlStream).
#[napi(object)]
pub struct PdfPageResult {
    /// 0-based index of this page
    pub page_index: u32,
    /// Total pages in the document
    pub page_count: u32,
    /// HTML fragment for this page (not a full document — no DOCTYPE/html/head/body)
    pub html: String,
    pub is_drm_protected: bool,
}

/// Convert a single page of a PDF to an HTML fragment.
///
/// Opens and closes the document on each call — designed for use by `pdfToHtmlStream`
/// in TypeScript which calls this per page to implement backpressure-aware streaming.
///
/// @param path - Path to the PDF file
/// @param pageIndex - 0-based page index to convert
/// @param options - Conversion options (password, dpi). startPage/endPage are ignored here.
#[napi]
pub async fn pdf_page_to_html(
    path: String,
    page_index: u32,
    options: Option<PdfConvertOptions>,
) -> Result<PdfPageResult> {
    tokio::task::spawn_blocking(move || -> Result<PdfPageResult> {
        let dpi = options.as_ref().and_then(|o| o.dpi).unwrap_or(150);
        let scale = dpi as f32 / 72.0;
        let password = options.as_ref().and_then(|o| o.password.as_deref());

        let (doc, is_drm) = open_and_auth(&path, password)?;

        let total = doc.page_count().map_err(|e| {
            Error::new(Status::GenericFailure, format!("Failed to get page count: {}", e))
        })? as u32;

        if page_index >= total {
            return Err(Error::new(
                Status::InvalidArg,
                format!("page_index {} out of range (document has {} pages)", page_index, total),
            ));
        }

        let seo_text_layer = options.as_ref().and_then(|o| o.seo_text_layer).unwrap_or(false);
        let (_, html) = convert_page(&doc, page_index as i32, scale, seo_text_layer)?;

        Ok(PdfPageResult {
            page_index,
            page_count: total,
            html,
            is_drm_protected: is_drm,
        })
    })
    .await
    .map_err(|e| Error::new(Status::GenericFailure, format!("Task panicked: {}", e)))?
}

/// Get PDF metadata without converting it.
/// Safe to call on DRM-protected PDFs — returns isDrmProtected: true without error.
///
/// @param path - Path to the PDF file
/// @param password - Optional password for DRM-protected PDFs
#[napi]
pub async fn pdf_info(path: String, password: Option<String>) -> Result<PdfInfo> {
    tokio::task::spawn_blocking(move || -> Result<PdfInfo> {
        let mut doc = Document::open(&path).map_err(|e| {
            Error::new(
                Status::GenericFailure,
                format!("Failed to open PDF: {}", e),
            )
        })?;

        let is_drm = doc.needs_password().unwrap_or(false);

        if is_drm {
            if let Some(ref pwd) = password {
                let _ = doc.authenticate(pwd);
            } else {
                return Ok(PdfInfo {
                    page_count: 0,
                    is_drm_protected: true,
                    title: None,
                    author: None,
                    subject: None,
                    creator: None,
                });
            }
        }

        let page_count = doc.page_count().unwrap_or(0) as u32;

        Ok(PdfInfo {
            page_count,
            is_drm_protected: is_drm,
            title: metadata_opt(&doc, MetadataName::Title),
            author: metadata_opt(&doc, MetadataName::Author),
            subject: metadata_opt(&doc, MetadataName::Subject),
            creator: metadata_opt(&doc, MetadataName::Creator),
        })
    })
    .await
    .map_err(|e| Error::new(Status::GenericFailure, format!("Task panicked: {}", e)))?
}
