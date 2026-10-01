import { downloadInvoiceDocument } from './poInvoicePdf.js';

const PAGE_WIDTH = 794;
const PAGE_HEIGHT = 1123;
const MARGIN = 44;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FOOTER_LINE_Y = 1082;
const LOGO_PLACEHOLDER = '__EVEXIA_LOGO__';
const DASH = '—';

const COLORS = {
  ink: '#20323a',
  muted: '#5d7077',
  accent: '#135a58',
  accentDeep: '#0e4444',
  accentText: '#ffffff',
  border: '#c7d7d6',
  grid: '#dce6e5',
  highlight: '#f2f8f7',
  panel: '#f8fbfa',
  warning: '#a4342e',
  warningFill: '#fff0ed',
};

const escapeXml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

function safeText(value) {
  if (value === null || value === undefined) return DASH;
  const text = String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
  return text || DASH;
}

function formatQuantity(value) {
  if (value === null || value === undefined || value === '') return DASH;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return safeText(value);
  return new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 3,
    useGrouping: true,
  }).format(number);
}

function wrapText(value, width, fontSize, maxLines = Infinity) {
  const text = safeText(value);
  const maxChars = Math.max(1, Math.floor(width / (fontSize * 0.54)));
  const result = [];

  for (const originalLine of text.split(/\r?\n/)) {
    const words = originalLine.split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words.length ? words : ['']) {
      const pieces = [];
      let piece = '';
      for (const character of Array.from(word)) {
        if (piece.length >= maxChars) {
          pieces.push(piece);
          piece = '';
        }
        piece += character;
      }
      if (piece || !pieces.length) pieces.push(piece);
      for (const part of pieces) {
        const candidate = line ? `${line} ${part}` : part;
        if (candidate.length > maxChars && line) {
          result.push(line);
          line = part;
        } else {
          line = candidate;
        }
      }
    }
    result.push(line || ' ');
  }
  return result.slice(0, maxLines).length ? result.slice(0, maxLines) : [DASH];
}

function textElement(x, y, value, options = {}) {
  const {
    size = 10, fill = COLORS.ink, weight = 400, anchor = 'start',
    letterSpacing = 0,
  } = options;
  return `<text x="${x}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" letter-spacing="${letterSpacing}">${escapeXml(value)}</text>`;
}

function wrappedText(x, baseline, lines, options = {}) {
  const lineHeight = options.lineHeight || (options.size || 10) * 1.25;
  return lines.map((line, index) =>
    textElement(x, baseline + index * lineHeight, line, options)).join('');
}

function normalizeReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new Error('A saved Purchase Received record is required to create its document.');
  }
  if (!Array.isArray(receipt.lines)) {
    throw new Error('Purchase Received document lines must be an array.');
  }

  const fields = [
    'id', 'number', 'poId', 'poNumber', 'poDate', 'receivedDate', 'receivedBy',
    'vendorId', 'vendorName', 'vendorPhone', 'locationId', 'locationName',
    'status', 'createdAt', 'updatedAt', 'deletedAt',
  ];
  const model = Object.fromEntries(fields.map((field) => [field, safeText(receipt[field])]));
  model.status = safeText(receipt.status || 'active');
  model.isDemo = receipt.isDemo === true || receipt.isSample === true || receipt.demo === true;
  model.lines = receipt.lines.map((line, index) => {
    if (!line || typeof line !== 'object' || Array.isArray(line)) {
      throw new Error(`Purchase Received document line ${index + 1} is invalid.`);
    }
    return {
      lineId: safeText(line.lineId),
      productId: safeText(line.productId),
      productName: safeText(line.productName),
      orderedQty: line.orderedQty,
      receivedQty: line.receivedQty,
      acceptedQty: line.acceptedQty,
      rejectedQty: line.rejectedQty,
      batchNo: safeText(line.batchNo),
      expiryDate: safeText(line.expiryDate),
    };
  });
  return model;
}

function drawPageHeader(model, pageIndex, pageCount) {
  const isContinuation = pageIndex > 0;
  const parts = [
    `<rect x="0" y="0" width="${PAGE_WIDTH}" height="126" fill="${COLORS.accent}"/>`,
    `<rect x="0" y="124" width="${PAGE_WIDTH}" height="3" fill="#42b6a7"/>`,
    `<rect x="${MARGIN}" y="27" width="128" height="68" rx="4" fill="#ffffff" stroke="#d5e4e3" stroke-width="1"/>`,
    `<image x="${MARGIN + 5}" y="32" width="118" height="58" href="${LOGO_PLACEHOLDER}" preserveAspectRatio="xMidYMid meet"/>`,
    textElement(MARGIN + 145, 48, 'EVEXIA', {
      size: 12, fill: '#d8f0ed', weight: 700, letterSpacing: 2,
    }),
    textElement(MARGIN + 145, 76, 'PURCHASE RECEIVED', {
      size: 22, fill: '#ffffff', weight: 700, letterSpacing: 0.4,
    }),
    textElement(PAGE_WIDTH - MARGIN, 49, safeText(model.number), {
      size: 13, fill: '#ffffff', weight: 700, anchor: 'end',
    }),
    textElement(PAGE_WIDTH - MARGIN, 70, 'RECEIPT DOCUMENT', {
      size: 8.4, fill: '#d8f0ed', weight: 700, anchor: 'end', letterSpacing: 0.8,
    }),
    textElement(isContinuation ? MARGIN : MARGIN + 145, 103,
      isContinuation
        ? `Continued · PR ${safeText(model.number)} · PO ${safeText(model.poNumber)}`
        : 'Browser-local receipt · Not a financial invoice', {
        size: 9.4, fill: '#ffffff', weight: isContinuation ? 600 : 400,
      }),
    textElement(PAGE_WIDTH - MARGIN, 103, `Page ${pageIndex + 1} of ${pageCount}`, {
      size: 8.5, fill: '#d8f0ed', anchor: 'end',
    }),
  ];
  return parts.join('');
}

function getDocumentMarkings(model) {
  const markings = ['LOCAL DEMO · NOT A STOCK-LEDGER ENTRY'];
  if (model.status.toLowerCase() === 'deleted') markings.push('DELETED · FOR REFERENCE');
  if (model.isDemo) markings.push('SAMPLE · PREVIEW ONLY');
  return markings;
}

function drawMarkings(model) {
  const markings = getDocumentMarkings(model);
  let x = MARGIN;
  const parts = [];
  for (const marking of markings) {
    const width = Math.min(CONTENT_WIDTH, Math.max(186, marking.length * 5.25 + 22));
    const warning = marking.startsWith('DELETED') || marking.startsWith('SAMPLE');
    parts.push(`<rect x="${x}" y="140" width="${width}" height="22" rx="4" fill="${warning ? COLORS.warningFill : COLORS.highlight}" stroke="${warning ? COLORS.warning : COLORS.border}" stroke-width="0.8"/>`);
    parts.push(textElement(x + width / 2, 154.5, marking, {
      size: 7.8, fill: warning ? COLORS.warning : COLORS.accentDeep, weight: 700, anchor: 'middle',
      letterSpacing: 0.25,
    }));
    x += width + 7;
  }
  return parts.join('');
}

function panelMarkup(x, y, width, title, fields) {
  const padding = 12;
  const labelSize = 7.8;
  const valueSize = 9.3;
  const valueWidth = width - padding * 2;
  const prepared = fields.map(([label, value]) => ({
    label,
    lines: wrapText(value, valueWidth, valueSize),
  }));
  const height = 34 + prepared.reduce((sum, field) => sum + 10 + field.lines.length * 11.4 + 5, 0);
  const parts = [
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="7" fill="${COLORS.panel}" stroke="${COLORS.border}" stroke-width="0.9"/>`,
    textElement(x + padding, y + 17, title, {
      size: 8, fill: COLORS.accent, weight: 700, letterSpacing: 0.65,
    }),
  ];
  let rowY = y + 31;
  for (const field of prepared) {
    parts.push(textElement(x + padding, rowY, field.label.toUpperCase(), {
      size: labelSize, fill: COLORS.muted, weight: 700, letterSpacing: 0.35,
    }));
    rowY += 11;
    parts.push(wrappedText(x + padding, rowY, field.lines, {
      size: valueSize, fill: COLORS.ink, weight: 500, lineHeight: 11.4,
    }));
    rowY += field.lines.length * 11.4 + 5;
  }
  return { markup: parts.join(''), height };
}

function drawReceiptDetails(model, y) {
  const gap = 10;
  const leftWidth = 334;
  const rightWidth = CONTENT_WIDTH - leftWidth - gap;
  const left = panelMarkup(MARGIN, y, leftWidth, 'RECEIPT DETAILS', [
    ['PR Number', model.number],
    ['Received Date', model.receivedDate],
    ['Received By', model.receivedBy],
  ]);
  const right = panelMarkup(MARGIN + leftWidth + gap, y, rightWidth, 'SOURCE & DESTINATION', [
    ['PO Number', model.poNumber],
    ['PO Date', model.poDate],
    ['Vendor', model.vendorName],
    ['Vendor Phone', model.vendorPhone],
    ['Destination', model.locationName],
  ]);
  return {
    markup: left.markup + right.markup,
    bottom: y + Math.max(left.height, right.height),
  };
}

const TABLE_COLUMNS = [
  { label: ['Sr.', 'No.'], width: 31 },
  { label: ['Product', 'Name'], width: 215 },
  { label: ['Ordered', 'Qty'], width: 68 },
  { label: ['Received', 'Qty'], width: 70 },
  { label: ['Accepted', 'Qty'], width: 70 },
  { label: ['Rejected', 'Qty'], width: 70 },
  { label: ['Batch No.'], width: 108 },
  { label: ['Expiry Date'], width: 74 },
];
const TABLE_WIDTH = TABLE_COLUMNS.reduce((sum, column) => sum + column.width, 0);
if (TABLE_WIDTH > CONTENT_WIDTH) {
  throw new Error('Purchase Received table columns exceed the printable page width.');
}
const TABLE_HEADER_HEIGHT = 36;
const TABLE_FONT = 8.7;
const TABLE_LINE_HEIGHT = 11;
const ROW_PADDING = 5;
const COLUMN_STARTS = TABLE_COLUMNS.reduce((starts, column) => {
  starts.push(starts.at(-1) + column.width);
  return starts;
}, [MARGIN]);
const CELL_WIDTHS = TABLE_COLUMNS.map((column, index) =>
  column.width - (index === 0 ? 4 : 9));

function makeRowFragments(lines) {
  const lineLimit = 8;
  const fragments = [];
  lines.forEach((line, index) => {
    const cellContents = [
      String(index + 1),
      safeText(line.productName),
      formatQuantity(line.orderedQty),
      formatQuantity(line.receivedQty),
      formatQuantity(line.acceptedQty),
      formatQuantity(line.rejectedQty),
      safeText(line.batchNo),
      safeText(line.expiryDate),
    ].map((value, column) => wrapText(value, CELL_WIDTHS[column], TABLE_FONT));
    const rowLineCount = Math.max(...cellContents.map((content) => content.length));
    for (let offset = 0; offset < rowLineCount; offset += lineLimit) {
      const cells = cellContents.map((content) => content.slice(offset, offset + lineLimit));
      if (offset > 0) cells[0] = [`${index + 1} (cont.)`];
      const visibleLines = Math.max(...cells.map((content) => content.length));
      fragments.push({
        cells,
        height: visibleLines * TABLE_LINE_HEIGHT + ROW_PADDING * 2,
      });
    }
  });
  return fragments;
}

function tableHeading(y) {
  const parts = [
    textElement(MARGIN, y - 8, 'RECEIVED PRODUCT DETAILS', {
      size: 9.2, fill: COLORS.ink, weight: 700, letterSpacing: 0.4,
    }),
    `<rect x="${MARGIN}" y="${y}" width="${TABLE_WIDTH}" height="${TABLE_HEADER_HEIGHT}" fill="${COLORS.accent}"/>`,
  ];
  TABLE_COLUMNS.forEach((column, index) => {
    const center = COLUMN_STARTS[index] + column.width / 2;
    const lineHeight = 9;
    const firstY = y + (TABLE_HEADER_HEIGHT - (column.label.length - 1) * lineHeight) / 2 + 3;
    parts.push(wrappedText(center, firstY, column.label, {
      size: 7.7, fill: COLORS.accentText, weight: 700, anchor: 'middle', lineHeight,
    }));
    if (index > 0) {
      parts.push(`<line x1="${COLUMN_STARTS[index]}" y1="${y}" x2="${COLUMN_STARTS[index]}" y2="${y + TABLE_HEADER_HEIGHT}" stroke="#ffffff" stroke-opacity="0.28" stroke-width="0.7"/>`);
    }
  });
  return parts.join('');
}

function drawRows(fragments, y, pageIndex) {
  const parts = [];
  let rowY = y;
  fragments.forEach((fragment, rowIndex) => {
    if ((rowIndex + pageIndex) % 2) {
      parts.push(`<rect x="${MARGIN}" y="${rowY}" width="${TABLE_WIDTH}" height="${fragment.height}" fill="${COLORS.highlight}"/>`);
    }
    parts.push(`<rect x="${MARGIN}" y="${rowY}" width="${TABLE_WIDTH}" height="${fragment.height}" fill="none" stroke="${COLORS.grid}" stroke-width="0.7"/>`);
    for (let column = 1; column < TABLE_COLUMNS.length; column += 1) {
      parts.push(`<line x1="${COLUMN_STARTS[column]}" y1="${rowY}" x2="${COLUMN_STARTS[column]}" y2="${rowY + fragment.height}" stroke="${COLORS.grid}" stroke-width="0.65"/>`);
    }
    fragment.cells.forEach((cell, column) => {
      if (!cell.length) return;
      const center = COLUMN_STARTS[column] + TABLE_COLUMNS[column].width / 2;
      const isCenter = column === 0 || (column >= 2 && column <= 5) || column === 7;
      const x = isCenter ? center : COLUMN_STARTS[column] + 5;
      parts.push(wrappedText(x, rowY + ROW_PADDING + TABLE_FONT, cell, {
        size: TABLE_FONT,
        fill: COLORS.ink,
        weight: column === 1 ? 500 : 400,
        anchor: isCenter ? 'middle' : 'start',
        lineHeight: TABLE_LINE_HEIGHT,
      }));
    });
    rowY += fragment.height;
  });
  return { markup: parts.join(''), bottom: rowY };
}

function drawContinuationSummary(model, y) {
  const leftText = `Received ${safeText(model.receivedDate)} · Received by ${safeText(model.receivedBy)}`;
  const rightText = `PO ${safeText(model.poNumber)}`;
  const leftLines = wrapText(leftText, CONTENT_WIDTH - 170, 8.5);
  const rightLines = wrapText(rightText, 150, 8.5);
  const height = Math.max(leftLines.length, rightLines.length) * 11 + 12;
  return {
    height,
    markup: [
      `<rect x="${MARGIN}" y="${y}" width="${CONTENT_WIDTH}" height="${height}" rx="5" fill="${COLORS.panel}" stroke="${COLORS.border}" stroke-width="0.8"/>`,
      wrappedText(MARGIN + 10, y + 14, leftLines, {
        size: 8.5, fill: COLORS.ink, weight: 500, lineHeight: 11,
      }),
      wrappedText(PAGE_WIDTH - MARGIN - 10, y + 14, rightLines, {
        size: 8.5, fill: COLORS.ink, weight: 700, anchor: 'end', lineHeight: 11,
      }),
    ].join(''),
  };
}

function drawFooter(pageIndex, pageCount) {
  return [
    `<line x1="${MARGIN}" y1="${FOOTER_LINE_Y}" x2="${PAGE_WIDTH - MARGIN}" y2="${FOOTER_LINE_Y}" stroke="${COLORS.grid}" stroke-width="0.8"/>`,
    textElement(MARGIN, FOOTER_LINE_Y + 15, 'Saved receipt details only · No inventory quantities are posted', {
      size: 8, fill: COLORS.muted,
    }),
    textElement(PAGE_WIDTH - MARGIN, FOOTER_LINE_Y + 15, `Page ${pageIndex + 1} of ${pageCount}`, {
      size: 8, fill: COLORS.muted, anchor: 'end',
    }),
  ].join('');
}

function renderPage(model, pageRows, pageIndex, pageCount, layout) {
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" viewBox="0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}" role="img" aria-label="Purchase Received ${escapeXml(safeText(model.number))}, page ${pageIndex + 1} of ${pageCount}">`,
    `<rect x="0" y="0" width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" fill="#ffffff"/>`,
    drawPageHeader(model, pageIndex, pageCount),
    drawMarkings(model),
  ];
  let headingY;
  if (pageIndex === 0) {
    parts.push(layout.details.markup);
    headingY = layout.headingY;
  } else {
    const summary = drawContinuationSummary(model, 174);
    parts.push(summary.markup);
    headingY = 174 + summary.height + 19;
  }
  parts.push(tableHeading(headingY));
  const { markup: rowMarkup } = drawRows(pageRows, headingY + TABLE_HEADER_HEIGHT, pageIndex);
  parts.push(rowMarkup, drawFooter(pageIndex, pageCount), '</svg>');
  return parts.join('');
}

/**
 * Make a normalized, saved-data-only Purchase Received document. Its SVG pages
 * are the shared source used by both the browser preview and on-device PDF.
 */
export function makePRDocument(receipt) {
  const model = normalizeReceipt(receipt);
  const leftWidth = 334;
  const rightFields = [
    ['PO Number', model.poNumber],
    ['PO Date', model.poDate],
    ['Vendor', model.vendorName],
    ['Vendor Phone', model.vendorPhone],
    ['Destination', model.locationName],
  ];
  const rightHeight = 34 + rightFields.reduce((sum, [, value]) =>
    sum + 10 + wrapText(value, CONTENT_WIDTH - leftWidth - 10 - 24, 9.3).length * 11.4 + 5, 0);
  const leftFields = [
    ['PR Number', model.number],
    ['Received Date', model.receivedDate],
    ['Received By', model.receivedBy],
  ];
  const leftHeight = 34 + leftFields.reduce((sum, [, value]) =>
    sum + 10 + wrapText(value, leftWidth - 24, 9.3).length * 11.4 + 5, 0);
  const details = drawReceiptDetails(model, 174);
  const headingY = Math.max(174 + Math.max(leftHeight, rightHeight), details.bottom) + 20;
  const fragments = makeRowFragments(model.lines);
  const firstCapacity = Math.max(0, FOOTER_LINE_Y - (headingY + TABLE_HEADER_HEIGHT + 4));
  const continuationLayout = drawContinuationSummary(model, 174);
  const continuationHeadingY = 174 + continuationLayout.height + 19;
  const continuationCapacity = FOOTER_LINE_Y -
    (continuationHeadingY + TABLE_HEADER_HEIGHT + 4);
  const pageRows = [];
  let index = 0;
  let capacity = firstCapacity;
  let isFirstPage = true;

  while (index < fragments.length) {
    const rows = [];
    let used = 0;
    while (index < fragments.length && fragments[index].height <= capacity - used) {
      rows.push(fragments[index]);
      used += fragments[index].height;
      index += 1;
    }
    pageRows.push(rows);
    if (isFirstPage && index < fragments.length && !rows.length) {
      // Preserve the complete receipt metadata on its own first page if it
      // leaves no room for a detail row; following pages use the compact key.
      isFirstPage = false;
    } else {
      isFirstPage = false;
    }
    capacity = continuationCapacity;
    if (capacity <= 0 && index < fragments.length) {
      throw new Error('Purchase Received document header leaves no room for item details.');
    }
  }
  if (!pageRows.length) pageRows.push([]);

  const pages = pageRows.map((rows, pageIndex) =>
    renderPage(model, rows, pageIndex, pageRows.length, { details, headingY }));
  return {
    number: model.number,
    templateId: 'classic',
    pages,
    model,
  };
}

/**
 * Rasterize the exact SVG pages used by the preview and download them as a
 * browser-local PDF using the existing, dependency-free invoice PDF pipeline.
 */
export async function downloadPRDocument(document, filename, logoUrl) {
  if (!document || typeof document !== 'object' ||
    !Array.isArray(document.pages) || document.pages.length === 0 ||
    document.pages.some((page) => typeof page !== 'string')) {
    throw new Error('Purchase Received document pages are missing; no PDF was downloaded.');
  }
  return downloadInvoiceDocument({
    templateId: 'classic',
    pages: document.pages,
  }, filename, logoUrl);
}