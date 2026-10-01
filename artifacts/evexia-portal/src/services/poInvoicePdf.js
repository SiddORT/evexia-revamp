const PDF_PAGE_WIDTH = 595.28;
const PDF_PAGE_HEIGHT = 841.89;
const LOGO_PLACEHOLDER = '__EVEXIA_LOGO__';
const encoder = new TextEncoder();

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new Error('Each invoice PDF page must contain JPEG bytes as a Uint8Array.');
}

function concatenate(parts) {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function ascii(value) {
  return encoder.encode(value);
}

/**
 * Serialize JPEG page images into a dependency-free, multipage PDF.
 * Pages use standard A4 portrait dimensions in PDF points.
 */
export function buildInvoicePdf(jpegPages) {
  if (!Array.isArray(jpegPages) || jpegPages.length === 0) {
    throw new Error('At least one rasterized invoice page is required to build a PDF.');
  }

  const pageData = jpegPages.map((page, index) => {
    if (!page || typeof page !== 'object') {
      throw new Error(`Invoice PDF page ${index + 1} is invalid.`);
    }
    const bytes = toBytes(page.bytes);
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 ||
      bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
      throw new Error(`Invoice PDF page ${index + 1} is not a complete JPEG image.`);
    }
    if (!Number.isSafeInteger(page.width) || page.width < 1 ||
      !Number.isSafeInteger(page.height) || page.height < 1) {
      throw new Error(`Invoice PDF page ${index + 1} has invalid image dimensions.`);
    }
    return { bytes, width: page.width, height: page.height };
  });

  const objectCount = 2 + pageData.length * 3;
  const parts = [
    ascii('%PDF-1.4\n'),
    new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]),
  ];
  let byteLength = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const offsets = new Array(objectCount + 1).fill(0);

  const writeObject = (objectNumber, objectParts) => {
    offsets[objectNumber] = byteLength;
    const body = [ascii(`${objectNumber} 0 obj\n`), ...objectParts, ascii('\nendobj\n')];
    parts.push(...body);
    byteLength += body.reduce((sum, part) => sum + part.byteLength, 0);
  };

  const pageObjectIds = pageData.map((_, index) => 3 + index * 3);
  writeObject(1, [ascii('<< /Type /Catalog /Pages 2 0 R >>')]);
  writeObject(2, [ascii(`<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageData.length} >>`)]);

  pageData.forEach((page, index) => {
    const pageId = 3 + index * 3;
    const imageId = pageId + 1;
    const contentId = pageId + 2;
    const content = ascii(
      `q\n${PDF_PAGE_WIDTH} 0 0 ${PDF_PAGE_HEIGHT} 0 0 cm\n/Im0 Do\nQ`,
    );
    writeObject(pageId, [ascii(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] ` +
      `/Resources << /ProcSet [/PDF /ImageC] /XObject << /Im0 ${imageId} 0 R >> >> ` +
      `/Contents ${contentId} 0 R >>`,
    )]);
    writeObject(imageId, [
      ascii(
        `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.byteLength} >>\nstream\n`,
      ),
      page.bytes,
      ascii('\nendstream'),
    ]);
    writeObject(contentId, [
      ascii(`<< /Length ${content.byteLength} >>\nstream\n`),
      content,
      ascii('\nendstream'),
    ]);
  });

  const xrefOffset = byteLength;
  let xref = `xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`;
  for (let objectNumber = 1; objectNumber <= objectCount; objectNumber += 1) {
    if (!Number.isSafeInteger(offsets[objectNumber]) || offsets[objectNumber] > 9999999999) {
      throw new Error('The invoice PDF is too large to serialize safely.');
    }
    xref += `${String(offsets[objectNumber]).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  parts.push(ascii(xref));
  return concatenate(parts);
}

function safeFilename(filename) {
  const supplied = typeof filename === 'string' ? filename : '';
  let cleaned = supplied
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .replace(/\.pdf$/i, '')
    .trim();
  if (!cleaned || cleaned === '.' || cleaned === '..') cleaned = 'purchase-order';
  return `${cleaned}.pdf`;
}

function currentLocation() {
  if (typeof window === 'undefined' || !window.location?.href) {
    throw new Error('Invoice PDF download requires a browser page with a same-origin logo URL.');
  }
  return window.location;
}

async function logoAsDataUri(logoUrl) {
  const location = currentLocation();
  if (typeof logoUrl !== 'string' || !logoUrl.trim()) {
    throw new Error('The Evexia logo URL is missing; the invoice PDF cannot be created.');
  }

  let resolved;
  try {
    resolved = new URL(logoUrl, location.href);
  } catch {
    throw new Error('The Evexia logo URL is invalid; the invoice PDF cannot be created.');
  }
  if (resolved.origin !== location.origin) {
    throw new Error('The Evexia logo must be loaded from the same origin to create the invoice PDF.');
  }

  let response;
  try {
    response = await fetch(resolved.href, { credentials: 'same-origin' });
  } catch {
    throw new Error('The Evexia logo could not be loaded. Check the connection and try the PDF download again.');
  }
  if (!response.ok) {
    throw new Error(`The Evexia logo could not be loaded (HTTP ${response.status}).`);
  }

  let blob;
  try {
    blob = await response.blob();
  } catch {
    throw new Error('The Evexia logo response could not be read for the invoice PDF.');
  }
  if (typeof FileReader === 'undefined') {
    throw new Error('This browser cannot convert the Evexia logo for the invoice PDF.');
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The Evexia logo could not be converted to an image for the invoice PDF.'));
    reader.onabort = () => reject(new Error('The Evexia logo conversion was cancelled.'));
    reader.onload = () => {
      if (typeof reader.result !== 'string' || !reader.result.startsWith('data:')) {
        reject(new Error('The Evexia logo conversion did not produce a usable image.'));
      } else {
        resolve(reader.result);
      }
    };
    try {
      reader.readAsDataURL(blob);
    } catch {
      reject(new Error('The Evexia logo could not be converted to an image for the invoice PDF.'));
    }
  });
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    let image;
    try {
      image = new Image();
    } catch {
      reject(new Error('An invoice page image could not be created for PDF rasterization.'));
      return;
    }
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('An invoice page could not be loaded for PDF rasterization.'));
    try {
      image.src = source;
    } catch {
      reject(new Error('An invoice page could not be loaded for PDF rasterization.'));
    }
  });
}

function canvasJpeg(canvas, pageNumber) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error(`Invoice page ${pageNumber} could not be rasterized as JPEG.`));
          return;
        }
        blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer))).catch(() => {
          reject(new Error(`Invoice page ${pageNumber} JPEG data could not be read.`));
        });
      }, 'image/jpeg', 0.94);
    } catch {
      reject(new Error(`Invoice page ${pageNumber} could not be rasterized as JPEG.`));
    }
  });
}

async function rasterizePage(svg, logoDataUri, pageNumber) {
  if (typeof document === 'undefined' || typeof Image === 'undefined' ||
    typeof URL?.createObjectURL !== 'function') {
    throw new Error('This browser does not support invoice page rasterization.');
  }
  if (typeof svg !== 'string' || !svg.includes(LOGO_PLACEHOLDER)) {
    throw new Error(`Invoice page ${pageNumber} is missing the Evexia logo placeholder.`);
  }
  const data = svg.replaceAll(LOGO_PLACEHOLDER, logoDataUri);
  let svgUrl;
  try {
    const blob = new Blob([data], { type: 'image/svg+xml;charset=utf-8' });
    svgUrl = URL.createObjectURL(blob);
  } catch {
    throw new Error(`Invoice page ${pageNumber} could not be prepared for PDF rasterization.`);
  }
  let image;
  let canvas;
  try {
    image = await loadImage(svgUrl);
    try {
      canvas = document.createElement('canvas');
    } catch {
      throw new Error(`Invoice page ${pageNumber} could not create a rasterization canvas.`);
    }
    canvas.width = 794 * 2;
    canvas.height = 1123 * 2;
    let context;
    try {
      context = canvas.getContext('2d');
    } catch {
      throw new Error(`Invoice page ${pageNumber} could not create a rasterization canvas.`);
    }
    if (!context) throw new Error(`Invoice page ${pageNumber} could not create a rasterization canvas.`);
    try {
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    } catch {
      throw new Error(`Invoice page ${pageNumber} could not be drawn onto the PDF canvas.`);
    }
    const bytes = await canvasJpeg(canvas, pageNumber);
    return { bytes, width: canvas.width, height: canvas.height };
  } finally {
    if (image) image.src = '';
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    try {
      URL.revokeObjectURL(svgUrl);
    } catch {
      // Cleanup should not replace a useful rasterization error.
    }
  }
}

/**
 * Create and download a real application/pdf document from renderer SVG pages.
 * Pages are rasterized sequentially to keep peak browser memory bounded.
 */
export async function downloadInvoiceDocument(invoiceDocument, filename, logoUrl) {
  if (!invoiceDocument || typeof invoiceDocument !== 'object' ||
    !Array.isArray(invoiceDocument.pages) || invoiceDocument.pages.length === 0) {
    throw new Error('Invoice document pages are missing; no PDF was downloaded.');
  }
  const allowedTemplates = ['classic', 'modern', 'compact'];
  if (!allowedTemplates.includes(invoiceDocument.templateId)) {
    throw new Error('The invoice document has an unsupported template.');
  }
  if (invoiceDocument.pages.some((page) => typeof page !== 'string')) {
    throw new Error('Invoice document pages must be SVG markup strings.');
  }

  const logoDataUri = await logoAsDataUri(logoUrl);
  const jpegPages = [];
  for (let index = 0; index < invoiceDocument.pages.length; index += 1) {
    jpegPages.push(await rasterizePage(invoiceDocument.pages[index], logoDataUri, index + 1));
  }
  const pdfBytes = buildInvoicePdf(jpegPages);
  if (typeof document === 'undefined' || typeof Blob === 'undefined' ||
    typeof URL?.createObjectURL !== 'function') {
    throw new Error('This browser cannot download the generated invoice PDF.');
  }

  let pdfBlob;
  try {
    pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
  } catch {
    throw new Error('The generated invoice PDF could not be packaged for download.');
  }
  let pdfUrl;
  try {
    pdfUrl = URL.createObjectURL(pdfBlob);
  } catch {
    throw new Error('The generated invoice PDF could not be prepared for download.');
  }
  let anchor;
  try {
    anchor = document.createElement('a');
  } catch {
    URL.revokeObjectURL(pdfUrl);
    throw new Error('The invoice PDF download could not be prepared.');
  }
  anchor.href = pdfUrl;
  anchor.download = safeFilename(filename);
  anchor.style.display = 'none';
  try {
    document.body.appendChild(anchor);
    anchor.click();
  } catch {
    try {
      URL.revokeObjectURL(pdfUrl);
    } catch {
      // Preserve the download failure as the actionable error.
    }
    throw new Error('The invoice PDF download could not be started.');
  } finally {
    try {
      anchor.remove();
    } catch {
      // The temporary anchor is not needed after the click attempt.
    }
  }
  setTimeout(() => {
    try {
      URL.revokeObjectURL(pdfUrl);
    } catch {
      // Browser URL cleanup is best-effort after the download has started.
    }
  }, 0);
}
