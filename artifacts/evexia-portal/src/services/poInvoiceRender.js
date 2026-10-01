const PAGE_WIDTH = 794;
const PAGE_HEIGHT = 1123;
const EM_DASH = '—';
const LOGO_PLACEHOLDER = '__EVEXIA_LOGO__';

const TEMPLATES = {
  classic: {
    name: 'Classic',
    margin: 50,
    logoWidth: 142,
    logoHeight: 70,
    companyFont: 10,
    metaFont: 9.6,
    tableFont: 9.2,
    tableLine: 11.2,
    rowPad: 5,
    headerHeight: 36,
    metadataPad: 11,
    colors: {
      ink: '#202426', muted: '#555e62', border: '#b7bec2', grid: '#d4d9dc',
      accent: '#30383c', accentText: '#ffffff', headerFill: '#f3f5f6',
      cardFill: '#ffffff', pageFill: '#ffffff', highlight: '#f8f9fa',
      warning: '#9b2c24', warningFill: '#fff0ed',
    },
  },
  modern: {
    name: 'Modern',
    margin: 44,
    logoWidth: 144,
    logoHeight: 68,
    companyFont: 10.2,
    metaFont: 9.5,
    tableFont: 9,
    tableLine: 11,
    rowPad: 6,
    headerHeight: 39,
    metadataPad: 12,
    colors: {
      ink: '#16263a', muted: '#52657b', border: '#bfd0df', grid: '#d8e3ed',
      accent: '#183c60', accentText: '#ffffff', headerFill: '#e9f1f8',
      cardFill: '#f7fafc', pageFill: '#ffffff', highlight: '#f1f6fa',
      warning: '#a4342e', warningFill: '#fff0ed',
    },
  },
  compact: {
    name: 'Compact',
    margin: 38,
    logoWidth: 118,
    logoHeight: 56,
    companyFont: 9.2,
    metaFont: 8.8,
    tableFont: 8.2,
    tableLine: 9.8,
    rowPad: 4,
    headerHeight: 32,
    metadataPad: 8,
    colors: {
      ink: '#26343a', muted: '#526168', border: '#aebbc1', grid: '#cbd4d8',
      accent: '#087c78', accentText: '#ffffff', headerFill: '#e4f3f1',
      cardFill: '#fbfdfd', pageFill: '#ffffff', highlight: '#f1f8f7',
      warning: '#a4342e', warningFill: '#fff0ed',
    },
  },
};

const escapeXml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

function display(value) {
  if (value === null || value === undefined) return EM_DASH;
  const text = String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  return text || EM_DASH;
}

function formatPaise(value) {
  if (!Number.isSafeInteger(value)) return EM_DASH;
  const negative = value < 0;
  const absolute = Math.abs(value);
  const rupees = Math.floor(absolute / 100);
  const paise = String(absolute % 100).padStart(2, '0');
  const grouped = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(rupees);
  return `${negative ? '-' : ''}₹${grouped}.${paise}`;
}

function formatRupees(value, maxFractionDigits = 2) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return EM_DASH;
  return `₹${new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  }).format(value)}`;
}

function formatDecimal(value, maxFractionDigits = 3) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return EM_DASH;
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  }).format(value);
}

function wrapText(value, maxWidth, fontSize) {
  const text = display(value);
  const maxChars = Math.max(1, Math.floor(maxWidth / (fontSize * 0.53)));
  const result = [];

  for (const originalLine of text.split(/\r?\n/)) {
    const words = originalLine.split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words.length ? words : ['']) {
      const pieces = [];
      let piece = '';
      for (const char of Array.from(word)) {
        if (piece.length >= maxChars) {
          pieces.push(piece);
          piece = '';
        }
        piece += char;
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
  return result.length ? result : [EM_DASH];
}

function textElement(x, y, value, options = {}) {
  const {
    size = 10, fill = '#202426', weight = 400, anchor = 'start',
    family = 'Arial, Helvetica, sans-serif', letterSpacing = 0,
  } = options;
  return `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" letter-spacing="${letterSpacing}">${escapeXml(value)}</text>`;
}

function wrappedText(x, baseline, lines, options = {}) {
  const lineHeight = options.lineHeight || (options.size || 10) * 1.25;
  return lines.map((line, index) => textElement(x, baseline + index * lineHeight, line, options)).join('');
}

function logoMarkup(config, top, colors) {
  const x = config.margin;
  const y = top;
  return `<rect x="${x}" y="${y}" width="${config.logoWidth}" height="${config.logoHeight}" rx="${config.logoRadius || 0}" fill="#ffffff" stroke="${colors.border}" stroke-width="0.8"/><image x="${x + 5}" y="${y + 5}" width="${config.logoWidth - 10}" height="${config.logoHeight - 10}" href="${LOGO_PLACEHOLDER}" preserveAspectRatio="xMidYMid meet"/>`;
}

function prepareLayout(model, template) {
  const config = { ...template, contentWidth: PAGE_WIDTH - template.margin * 2 };
  const company = model.company || {};
  const vendor = model.vendor || {};
  const companyX = config.margin + config.logoWidth + 22;
  const companyWidth = PAGE_WIDTH - config.margin - companyX;
  const companyFields = [
    { value: display(company.name), size: config.companyFont + 1, weight: 700, gap: 3 },
    { value: display(company.address), size: config.metaFont, weight: 400, gap: 2 },
    { value: display(company.email), size: config.metaFont, weight: 400, gap: 1 },
    { value: display(company.website), size: config.metaFont, weight: 400, gap: 0 },
  ].map((field) => ({
    ...field,
    lines: wrapText(field.value, companyWidth, field.size),
    lineHeight: field.size * 1.25,
  }));
  const companyHeight = companyFields.reduce((height, field) =>
    height + field.lines.length * field.lineHeight + field.gap, 0);
  const headerBottom = Math.max(config.logoHeight + 48, 34 + companyHeight + 9);
  const hasStatusBadge = String(model.status || '').toLowerCase() === 'deleted' || Boolean(model.isSample);
  const metaY = headerBottom + 14 + (hasStatusBadge ? 24 : 0);
  const gap = 10;
  const leftWidth = Math.round((config.contentWidth - gap) * 0.53);
  const rightWidth = config.contentWidth - gap - leftWidth;
  const inner = config.metadataPad;
  const vendorNameLines = wrapText(vendor.name, leftWidth - inner * 2, config.metaFont + 0.3);
  const vendorAddressLines = wrapText(vendor.address, leftWidth - inner * 2, config.metaFont);
  const vendorGstLines = wrapText(`GST No: ${display(vendor.gstNo)}`, leftWidth - inner * 2, config.metaFont);
  const vendorHeight = inner + 12 + vendorNameLines.length * 12 +
    vendorAddressLines.length * 11.5 + vendorGstLines.length * 11.5 + inner;
  const rightLabelWidth = Math.min(99, rightWidth * 0.34);
  const rightValueWidth = rightWidth - inner * 2 - rightLabelWidth - 4;
  const metadataRows = [
    ['PO Number', display(model.number)],
    ['PO Date', display(model.poDate)],
    ['Expected Date', display(model.expectedDate)],
    ['Location', display(model.locationName)],
    ['Status', display(model.status)],
  ].map(([label, value]) => ({
    label, value, lines: wrapText(value, rightValueWidth, config.metaFont),
  }));
  const rightHeight = inner + 12 + metadataRows.reduce((height, row) =>
    height + Math.max(1, row.lines.length) * 11.5 + 3, 0);
  const metaHeight = Math.max(vendorHeight, rightHeight);
  const tableY = metaY + metaHeight + 22;
  const isCompact = template === TEMPLATES.compact;
  const columnWidths = isCompact
    ? [40, 169, 70, 76, 80, 58, config.contentWidth - 493]
    : template === TEMPLATES.modern
      ? [43, 184, 70, 78, 83, 56, config.contentWidth - 514]
      : [42, 176, 74, 78, 82, 57, config.contentWidth - 509];
  const columnStarts = [config.margin];
  for (const width of columnWidths) columnStarts.push(columnStarts.at(-1) + width);
  const tableFont = config.tableFont;
  const cellWidths = columnWidths.map((width, index) => width - (index === 0 ? 6 : 12));
  const headerLabels = [
    ['S.No'],
    ['Product', 'Description'],
    ['HSN Code'],
    ['Unit Price'],
    ['Purchase Qty'],
    ['GST %'],
    ['Gross Amount'],
  ];
  const footerAt = PAGE_HEIGHT - 68;
  const continueLimit = footerAt - 30;
  const finalReserve = 202;
  const contentStart = tableY + config.headerHeight;
  const continueCapacity = continueLimit - contentStart;
  const finalCapacity = continueCapacity - finalReserve;

  return {
    config, company, vendor, companyX, companyWidth, companyFields, headerBottom,
    metaY, metaHeight, leftWidth, rightWidth, vendorNameLines, vendorAddressLines,
    vendorGstLines, rightLabelWidth, rightValueWidth, metadataRows, tableY,
    columnWidths, columnStarts, cellWidths, headerLabels, contentStart,
    continueLimit, continueCapacity, finalCapacity, footerAt,
  };
}

function rowCellValues(line, index) {
  return [
    String(index + 1),
    display(line.productName),
    display(line.hsnCode),
    formatRupees(line.unitPrice),
    formatDecimal(line.quantity),
    typeof line.gst === 'number' && Number.isFinite(line.gst) ? `${formatDecimal(line.gst, 2)}%` : EM_DASH,
    formatPaise(line.total),
  ];
}

function makeRowFragments(lines, layout) {
  const { config, cellWidths } = layout;
  const fragments = [];
  const fragmentLineLimit = 10;
  for (let index = 0; index < lines.length; index += 1) {
    const content = rowCellValues(lines[index], index).map((value, column) =>
      wrapText(value, cellWidths[column], config.tableFont));
    const lineCount = Math.max(...content.map((column) => column.length));
    for (let offset = 0; offset < lineCount; offset += fragmentLineLimit) {
      const first = offset === 0;
      const values = content.map((column) => column.slice(offset, offset + fragmentLineLimit));
      if (!first && values[1].length) values[1].unshift('(continued)');
      if (!first) values[0] = wrapText(`${index + 1} (cont.)`, cellWidths[0], config.tableFont);
      const visibleLines = Math.max(...values.map((column) => column.length));
      fragments.push({
        cells: values,
        height: visibleLines * config.tableLine + config.rowPad * 2,
      });
    }
  }
  return fragments;
}

function paginate(fragments, layout) {
  if (!fragments.length) return [[]];
  const pages = [];
  let index = 0;
  while (index < fragments.length) {
    const remainingHeight = fragments.slice(index).reduce((sum, fragment) => sum + fragment.height, 0);
    if (remainingHeight <= layout.finalCapacity) {
      pages.push(fragments.slice(index));
      break;
    }
    const page = [];
    let used = 0;
    while (index < fragments.length - 1 &&
      used + fragments[index].height <= layout.continueCapacity &&
      (page.length === 0 || remainingHeight - used - fragments[index].height > layout.finalCapacity)) {
      // Never consume the final remaining fragment on a continuation page.
      // If that row itself cannot share the final page with its footer, it is
      // emitted on this continuation page and followed by a totals-only page.
      if (page.length === 0 && index === fragments.length - 1 &&
        remainingHeight > layout.finalCapacity) break;
      page.push(fragments[index]);
      used += fragments[index].height;
      index += 1;
    }
    if (!page.length) {
      const finalRow = fragments[index];
      if (finalRow && finalRow.height <= layout.continueCapacity) {
        pages.push([finalRow]);
        index += 1;
        if (index === fragments.length) pages.push([]);
        continue;
      }
      throw new Error('Invoice header leaves insufficient space for a wrapped item row.');
    }
    pages.push(page);
  }
  return pages;
}

function drawCompanyHeader(layout, colors, isModern) {
  const {
    config, companyX, companyFields, headerBottom,
  } = layout;
  const chunks = [];
  if (isModern) {
    chunks.push(`<rect x="0" y="0" width="${PAGE_WIDTH}" height="${headerBottom}" fill="${colors.accent}"/>`);
    chunks.push(`<rect x="0" y="${headerBottom}" width="${PAGE_WIDTH}" height="2" fill="#20b5a8"/>`);
  } else {
    chunks.push(`<line x1="${config.margin}" y1="${headerBottom}" x2="${PAGE_WIDTH - config.margin}" y2="${headerBottom}" stroke="${colors.accent}" stroke-width="1.4"/>`);
  }
  chunks.push(logoMarkup(config, 34, colors));
  let y = 43;
  for (const field of companyFields) {
    const fill = isModern ? '#ffffff' : (field.weight === 700 ? colors.ink : colors.muted);
    chunks.push(wrappedText(companyX, y, field.lines, {
      size: field.size, fill, weight: field.weight, lineHeight: field.lineHeight,
    }));
    y += field.lines.length * field.lineHeight + field.gap;
  }
  return chunks.join('');
}

function drawMetadata(layout, colors, model, isModern) {
  const {
    config, metaY, metaHeight, leftWidth, rightWidth, vendorNameLines,
    vendorAddressLines, vendorGstLines, rightLabelWidth, rightValueWidth,
    metadataRows,
  } = layout;
  const leftX = config.margin;
  const rightX = leftX + leftWidth + 10;
  const chunks = [];
  const boxFill = isModern ? colors.cardFill : colors.pageFill;
  for (const [x, width] of [[leftX, leftWidth], [rightX, rightWidth]]) {
    chunks.push(`<rect x="${x}" y="${metaY}" width="${width}" height="${metaHeight}" rx="${isModern ? 8 : 2}" fill="${boxFill}" stroke="${colors.border}" stroke-width="1"/>`);
  }
  const pad = config.metadataPad;
  const vendorTop = metaY + pad + 11;
  chunks.push(textElement(leftX + pad, vendorTop, 'SUPPLIER', {
    size: config.metaFont - 0.3, fill: colors.muted, weight: 700, letterSpacing: 0.7,
  }));
  let y = vendorTop + 18;
  const vendorFont = config.metaFont + 0.3;
  chunks.push(wrappedText(leftX + pad, y, vendorNameLines, {
    size: vendorFont, fill: colors.ink, weight: 700, lineHeight: 12,
  }));
  y += vendorNameLines.length * 12 + 2;
  chunks.push(wrappedText(leftX + pad, y, vendorAddressLines, {
    size: config.metaFont, fill: colors.ink, lineHeight: 11.5,
  }));
  y += vendorAddressLines.length * 11.5 + 1;
  chunks.push(wrappedText(leftX + pad, y, vendorGstLines, {
    size: config.metaFont, fill: colors.ink, weight: 600, lineHeight: 11.5,
  }));

  const rowBase = metaY + pad + 11;
  let rowY = rowBase;
  for (const row of metadataRows) {
    chunks.push(textElement(rightX + pad, rowY, `${row.label}:`, {
      size: config.metaFont - 0.1, fill: colors.muted, weight: 700,
    }));
    chunks.push(wrappedText(rightX + pad + rightLabelWidth, rowY, row.lines, {
      size: config.metaFont, fill: colors.ink,
      weight: row.label === 'PO Number' ? 700 : 400, lineHeight: 11.5,
    }));
    rowY += Math.max(1, row.lines.length) * 11.5 + 3;
  }

  const badges = [];
  if (String(model.status || '').toLowerCase() === 'deleted') {
    badges.push({ text: 'DELETED / FOR REFERENCE', width: 190 });
  }
  if (model.isSample) badges.push({ text: 'SAMPLE / PREVIEW ONLY', width: 166 });
  let badgeX = config.margin + config.contentWidth - badges.reduce((sum, badge) => sum + badge.width, 0) -
    Math.max(0, badges.length - 1) * 6;
  for (const badge of badges) {
    const badgeY = metaY - 13;
    chunks.push(`<rect x="${badgeX}" y="${badgeY - 11}" width="${badge.width}" height="19" rx="${isModern ? 8 : 2}" fill="${colors.warningFill}" stroke="${colors.warning}" stroke-width="0.8"/>`);
    chunks.push(textElement(badgeX + badge.width / 2, badgeY + 2, badge.text, {
      size: 8.2, fill: colors.warning, weight: 700, anchor: 'middle', letterSpacing: 0.2,
    }));
    badgeX += badge.width + 6;
  }
  return chunks.join('');
}

function drawTableHeader(layout, colors) {
  const { config, tableY, columnStarts, columnWidths, headerLabels } = layout;
  const chunks = [
    textElement(config.margin, tableY - 9, 'PURCHASE ORDER DETAILS', {
      size: config.tableFont + 1, fill: colors.ink, weight: 700, letterSpacing: 0.5,
    }),
    `<rect x="${config.margin}" y="${tableY}" width="${config.contentWidth}" height="${config.headerHeight}" fill="${colors.accent}"/>`,
  ];
  for (let column = 0; column < columnWidths.length; column += 1) {
    const center = columnStarts[column] + columnWidths[column] / 2;
    const lines = headerLabels[column];
    const lineHeight = config.tableFont * 1.2;
    const firstY = tableY + (config.headerHeight - (lines.length - 1) * lineHeight) / 2 + config.tableFont * 0.35;
    chunks.push(wrappedText(center, firstY, lines, {
      size: config.tableFont - 0.3, fill: colors.accentText,
      weight: 700, anchor: 'middle', lineHeight,
    }));
    if (column) {
      chunks.push(`<line x1="${columnStarts[column]}" y1="${tableY}" x2="${columnStarts[column]}" y2="${tableY + config.headerHeight}" stroke="${colors.accentText}" stroke-opacity="0.3" stroke-width="0.7"/>`);
    }
  }
  return chunks.join('');
}

function drawRows(pageRows, layout, colors, pageIndex) {
  const { config, tableY, contentStart, columnStarts, columnWidths } = layout;
  const chunks = [];
  let y = contentStart;
  pageRows.forEach((row, rowIndex) => {
    const alternate = (rowIndex + pageIndex) % 2 === 1;
    if (alternate) {
      chunks.push(`<rect x="${config.margin}" y="${y}" width="${config.contentWidth}" height="${row.height}" fill="${colors.highlight}"/>`);
    }
    chunks.push(`<rect x="${config.margin}" y="${y}" width="${config.contentWidth}" height="${row.height}" fill="none" stroke="${colors.grid}" stroke-width="0.75"/>`);
    for (let column = 1; column < columnWidths.length; column += 1) {
      chunks.push(`<line x1="${columnStarts[column]}" y1="${y}" x2="${columnStarts[column]}" y2="${y + row.height}" stroke="${colors.grid}" stroke-width="0.65"/>`);
    }
    row.cells.forEach((lines, column) => {
      if (!lines.length) return;
      const startY = y + config.rowPad + config.tableFont;
      const isRight = [3, 4, 6].includes(column);
      const isCenter = [0, 2, 5].includes(column);
      const x = isRight
        ? columnStarts[column] + columnWidths[column] - 6
        : isCenter
          ? columnStarts[column] + columnWidths[column] / 2
          : columnStarts[column] + 6;
      chunks.push(wrappedText(x, startY, lines, {
        size: config.tableFont,
        fill: colors.ink,
        weight: column === 6 ? 600 : 400,
        anchor: isRight ? 'end' : isCenter ? 'middle' : 'start',
        lineHeight: config.tableLine,
      }));
    });
    y += row.height;
  });
  return { markup: chunks.join(''), endY: y };
}

function drawContinuationFooter(layout, colors, pageNumber, pageCount) {
  const { config, footerAt } = layout;
  return [
    `<line x1="${config.margin}" y1="${footerAt - 19}" x2="${PAGE_WIDTH - config.margin}" y2="${footerAt - 19}" stroke="${colors.grid}" stroke-width="0.8"/>`,
    textElement(config.margin, footerAt, `Continued on the next page · PO ${display(layout.modelNumber)}`, {
      size: 8.5, fill: colors.muted,
    }),
    textElement(PAGE_WIDTH - config.margin, footerAt, `Page ${pageNumber} of ${pageCount}`, {
      size: 8.5, fill: colors.muted, anchor: 'end',
    }),
  ].join('');
}

function drawFinalFooter(layout, colors, model, rowsEndY, pageNumber, pageCount) {
  const { config } = layout;
  const contentRight = PAGE_WIDTH - config.margin;
  const totalsWidth = Math.min(310, config.contentWidth * 0.47);
  const totalsX = contentRight - totalsWidth;
  const totalsTop = rowsEndY + 15;
  const labelX = totalsX + 10;
  const valueX = contentRight - 10;
  const totals = [
    ['Taxable Amount', formatPaise(model.subtotal)],
    ['GST Amount', formatPaise(model.gstAmount)],
    ['Total Amount', formatPaise(model.total)],
  ];
  const chunks = [];
  totals.forEach(([label, amount], index) => {
    const y = totalsTop + index * 27;
    const fill = index === 2 ? colors.highlight : colors.pageFill;
    chunks.push(`<rect x="${totalsX}" y="${y - 18}" width="${totalsWidth}" height="25" fill="${fill}" stroke="${colors.grid}" stroke-width="0.75"/>`);
    chunks.push(textElement(labelX, y, label, {
      size: config.metaFont + 0.1, fill: colors.ink, weight: index === 2 ? 700 : 600,
    }));
    chunks.push(textElement(valueX, y, amount, {
      size: config.metaFont + 0.1, fill: colors.ink, weight: 700, anchor: 'end',
    }));
  });

  const certificationY = totalsTop + 27 * totals.length + 23;
  const certWidth = Math.max(200, config.contentWidth - 250);
  const certification = wrapText(
    'Certified that the particulars given above are true and correct.',
    certWidth, config.metaFont,
  );
  chunks.push(wrappedText(config.margin, certificationY, certification, {
    size: config.metaFont, fill: colors.ink, lineHeight: 13,
  }));
  const signX = contentRight - Math.min(250, config.contentWidth * 0.36);
  const signWidth = contentRight - signX;
  const signY = certificationY + 19;
  const signHeight = 78;
  chunks.push(`<rect x="${signX}" y="${signY}" width="${signWidth}" height="${signHeight}" fill="${colors.pageFill}" stroke="${colors.grid}" stroke-width="0.9"/>`);
  const companyLines = wrapText(model.company?.name, signWidth - 16, config.metaFont - 0.5);
  chunks.push(wrappedText(signX + signWidth / 2, signY + 18, companyLines, {
    size: config.metaFont - 0.5, fill: colors.ink, weight: 700, anchor: 'middle', lineHeight: 11,
  }));
  chunks.push(textElement(signX + signWidth / 2, signY + signHeight - 13, 'Authorised Signatory', {
    size: config.metaFont - 0.2, fill: colors.muted, weight: 700, anchor: 'middle', letterSpacing: 0.5,
  }));

  const footerAt = PAGE_HEIGHT - 36;
  chunks.push(`<line x1="${config.margin}" y1="${footerAt - 14}" x2="${contentRight}" y2="${footerAt - 14}" stroke="${colors.grid}" stroke-width="0.8"/>`);
  chunks.push(textElement(config.margin, footerAt, `Purchase Order · ${display(model.number)}`, {
    size: 8.2, fill: colors.muted,
  }));
  chunks.push(textElement(contentRight, footerAt, `Page ${pageNumber} of ${pageCount}`, {
    size: 8.2, fill: colors.muted, anchor: 'end',
  }));
  return chunks.join('');
}

function svgPage(layout, model, rows, pageIndex, pageCount, isLast) {
  const { config } = layout;
  const colors = config.colors;
  const modern = config === TEMPLATES.modern || layout.templateId === 'modern';
  const { markup: rowMarkup, endY } = drawRows(rows, layout, colors, pageIndex);
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" viewBox="0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}" role="img" aria-label="Purchase order invoice page ${pageIndex + 1} of ${pageCount}">`,
    `<rect x="0" y="0" width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" fill="${colors.pageFill}"/>`,
    drawCompanyHeader(layout, colors, modern),
    drawMetadata(layout, colors, model, modern),
    drawTableHeader(layout, colors),
    rowMarkup,
    isLast
      ? drawFinalFooter(layout, colors, model, endY, pageIndex + 1, pageCount)
      : drawContinuationFooter({ ...layout, modelNumber: model.number }, colors, pageIndex + 1, pageCount),
    '</svg>',
  ];
  return parts.join('');
}

/**
 * Render a purchase order as one or more self-contained A4 SVG pages.
 * The logo href is deliberately left as __EVEXIA_LOGO__ for the caller to replace.
 */
export function renderPOInvoicePages(model, templateId = 'classic') {
  if (!Object.hasOwn(TEMPLATES, templateId)) {
    throw new Error(`Unsupported purchase order invoice template: ${String(templateId)}`);
  }
  if (!model || typeof model !== 'object' || Array.isArray(model)) {
    throw new Error('A purchase order invoice model is required.');
  }
  if (!Array.isArray(model.lines)) {
    throw new Error('Purchase order invoice lines must be an array.');
  }

  const template = TEMPLATES[templateId];
  const layout = prepareLayout(model, template);
  layout.templateId = templateId;
  const fragments = makeRowFragments(model.lines, layout);
  const pageRows = paginate(fragments, layout);
  return pageRows.map((rows, index) =>
    svgPage(layout, model, rows, index, pageRows.length, index === pageRows.length - 1));
}
