const PAGE_WIDTH = 794;
const PAGE_HEIGHT = 1123;
const MARGIN = 44;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const NORMAL_END_Y = 1054;
const FINAL_END_Y = 785;
const BODY_START_Y = 174;
const LOGO_PLACEHOLDER = '__EVEXIA_LOGO__';
const DASH = '—';

const COMPANY = {
  name: 'EVEXIA LIFE SCIENCES PVT. LTD.',
  address: '2nd floor, Laud Mansion, Mumbai - 400 004',
  email: 'info@evexialifesciences.com',
  website: 'www.evexialifesciences.com',
};

const COLORS = {
  ink: '#202426',
  muted: '#555e62',
  border: '#b7bec2',
  grid: '#d4d9dc',
  header: '#f3f5f6',
  headerText: '#202426',
  highlight: '#f8f9fa',
  warning: '#9b2c24',
  warningFill: '#fff0ed',
};

const MAIN_COLUMNS = [
  { label: ['S.No.'], width: 42 },
  { label: ['Product', 'Description'], width: 198 },
  { label: ['Ordered', 'Qty'], width: 92 },
  { label: ['Received', 'Qty'], width: 92 },
  { label: ['Accepted', 'Qty'], width: 94 },
  { label: ['Balance', 'Qty'], width: 94 },
  { label: ['Rejected', 'Qty'], width: 94 },
];

const SUPPLEMENT_COLUMNS = [
  { label: ['S.No.'], width: 34 },
  { label: ['Source', 'Line ID'], width: 112 },
  { label: ['Product', 'Description'], width: 190 },
  { label: ['Location'], width: 108 },
  { label: ['Batch No.'], width: 140 },
  { label: ['Expiry Date'], width: 122 },
];

const TABLE_HEADER_HEIGHT = 38;
const TABLE_FONT = 8.6;
const TABLE_LINE_HEIGHT = 10.8;
const ROW_PADDING = 5;
const ROW_FRAGMENT_LINES = 7;
const METADATA_LINE_HEIGHT = 11.4;

const escapeXml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

function safeText(value) {
  if (value === null || value === undefined) return DASH;
  const text = String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E\u000F-\u001F\u007F]/g, '')
    .trim();
  return text || DASH;
}

function wrapText(value, width, fontSize) {
  const text = safeText(value);
  const maxChars = Math.max(1, Math.floor(width / (fontSize * 0.54)));
  const result = [];

  for (const originalLine of text.split(/\r?\n/)) {
    const words = originalLine.split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words.length ? words : ['']) {
      let piece = '';
      const pieces = [];
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
  return result.length ? result : [DASH];
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

function quantity(value) {
  if (value === null || value === undefined || value === '') return DASH;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return safeText(value);
  return new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 3,
    useGrouping: true,
  }).format(number);
}

function normalizeModel(model) {
  if (!model || typeof model !== 'object' || Array.isArray(model)) {
    throw new Error('A saved Purchase Received document model is required.');
  }
  if (!Array.isArray(model.lines)) {
    throw new Error('Purchase Received document lines must be an array.');
  }
  return {
    number: safeText(model.number),
    receivedDate: safeText(model.receivedDate),
    receivedBy: safeText(model.receivedBy),
    poNumber: safeText(model.poNumber),
    poDate: safeText(model.poDate),
    locationName: safeText(model.locationName),
    status: safeText(model.status || 'active'),
    deletedAt: safeText(model.deletedAt),
    isSample: model.isSample === true,
    vendorName: safeText(model.vendorName),
    vendorAddress: safeText(model.vendorAddress),
    vendorGstNo: safeText(model.vendorGstNo),
    vendorPhone: safeText(model.vendorPhone),
    lines: model.lines.map((line, index) => {
      if (!line || typeof line !== 'object' || Array.isArray(line)) {
        throw new Error(`Purchase Received document line ${index + 1} is invalid.`);
      }
      return {
        lineId: safeText(line.lineId),
        productName: safeText(line.productName),
        orderedQty: line.orderedQty,
        receivedQty: line.receivedQty,
        acceptedQty: line.acceptedQty,
        rejectedQty: line.rejectedQty,
        balanceAfterQty: line.balanceAfterQty,
        batchNo: safeText(line.batchNo),
        expiryDate: safeText(line.expiryDate),
      };
    }),
  };
}

function drawPageHeader(model, pageIndex, pageCount) {
  const companyFields = [
    { text: COMPANY.name, size: 9.3, weight: 700, gap: 2 },
    { text: COMPANY.address, size: 8.2, weight: 400, gap: 2 },
    { text: COMPANY.email, size: 8.2, weight: 400, gap: 2 },
    { text: COMPANY.website, size: 8.2, weight: 400, gap: 0 },
  ];
  const parts = [
    `<rect x="0" y="0" width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" fill="#ffffff"/>`,
    `<rect x="${MARGIN}" y="27" width="142" height="70" rx="1" fill="#ffffff" stroke="#b7bec2" stroke-width="0.8"/>`,
    `<image x="${MARGIN + 5}" y="32" width="132" height="60" href="${LOGO_PLACEHOLDER}" preserveAspectRatio="xMidYMid meet"/>`,
  ];
  let companyY = 39;
  for (const field of companyFields) {
    const lines = wrapText(field.text, 360, field.size);
    parts.push(wrappedText(386, companyY, lines, {
      size: field.size, fill: COLORS.ink, weight: field.weight, lineHeight: field.size * 1.3,
    }));
    companyY += lines.length * field.size * 1.3 + field.gap;
  }
  parts.push(
    `<line x1="${MARGIN}" y1="119" x2="${PAGE_WIDTH - MARGIN}" y2="119" stroke="${COLORS.header}" stroke-width="1.2"/>`,
    textElement(MARGIN, 137, 'PURCHASE RECEIVED', {
      size: 8.5, fill: COLORS.muted, weight: 700, letterSpacing: 0.65,
    }),
    textElement(PAGE_WIDTH - MARGIN, 137, `PR ${model.number}  ·  PO ${model.poNumber}`, {
      size: 8, fill: COLORS.ink, weight: 600, anchor: 'end',
    }),
    textElement(PAGE_WIDTH - MARGIN, 153, `Page ${pageIndex + 1} of ${pageCount}`, {
      size: 7.8, fill: COLORS.muted, anchor: 'end',
    }),
  );

  const markings = ['LOCAL DEMO · NOT A STOCK-LEDGER ENTRY'];
  if (model.status.toLowerCase() === 'deleted' || model.deletedAt !== DASH) {
    markings.push('DELETED · FOR REFERENCE');
  }
  if (model.isSample) markings.push('SAMPLE · PREVIEW ONLY');
  let x = MARGIN;
  for (const marking of markings) {
    const warning = marking.startsWith('DELETED') || marking.startsWith('SAMPLE');
    const width = Math.min(CONTENT_WIDTH, Math.max(185, marking.length * 5.15 + 20));
    parts.push(
      `<rect x="${x}" y="145" width="${width}" height="22" rx="1" fill="${warning ? COLORS.warningFill : '#f3f5f6'}" stroke="${warning ? COLORS.warning : COLORS.border}" stroke-width="0.8"/>`,
      textElement(x + width / 2, 159.5, marking, {
        size: 7.5, fill: warning ? COLORS.warning : COLORS.ink, weight: 700, anchor: 'middle',
      }),
    );
    x += width + 7;
  }
  return parts.join('');
}

function splitField(label, value, width) {
  const lines = wrapText(value, width, 8.7);
  const fields = [];
  for (let offset = 0; offset < lines.length; offset += ROW_FRAGMENT_LINES) {
    const part = offset / ROW_FRAGMENT_LINES;
    fields.push({
      label: part ? `${label} (continued)` : label,
      labelLines: wrapText(part ? `${label} (continued)` : label, width, 7.2),
      valueLines: lines.slice(offset, offset + ROW_FRAGMENT_LINES),
    });
  }
  return fields;
}

function fieldHeight(field) {
  if (!field) return 0;
  return 24 + field.labelLines.length * 9 + field.valueLines.length * METADATA_LINE_HEIGHT + 5;
}

function makeMetadataUnits(model) {
  const leftFields = [
    ['Vendor', model.vendorName],
    ['Address', model.vendorAddress],
    ['GST No.', model.vendorGstNo],
  ];
  const rightFields = [
    ['PR Number', model.number],
    ['PR Date', model.receivedDate],
  ];
  const left = leftFields.flatMap(([label, value]) => splitField(label, value, 300));
  const right = rightFields.flatMap(([label, value]) => splitField(label, value, 330));
  return Array.from({ length: Math.max(left.length, right.length) }, (_, index) => {
    const leftField = left[index] || null;
    const rightField = right[index] || null;
    return {
      type: 'metadata',
      leftField,
      rightField,
      height: Math.max(fieldHeight(leftField), fieldHeight(rightField), 54),
    };
  });
}

function makeSourceUnits(model) {
  const leftFields = [
    ['Linked PO Number', model.poNumber],
    ['Receiver (recorded only; identity not independently verified)', model.receivedBy],
    ['Vendor Phone', model.vendorPhone],
  ];
  const rightFields = [
    ['Linked PO Date', model.poDate],
    ['Destination', model.locationName],
  ];
  const left = leftFields.flatMap(([label, value]) => splitField(label, value, 300));
  const right = rightFields.flatMap(([label, value]) => splitField(label, value, 330));
  return Array.from({ length: Math.max(left.length, right.length) }, (_, index) => {
    const leftField = left[index] || null;
    const rightField = right[index] || null;
    return {
      type: 'source',
      leftField,
      rightField,
      height: Math.max(fieldHeight(leftField), fieldHeight(rightField), 54),
    };
  });
}

function getColumnGeometry(columns) {
  const starts = [MARGIN];
  for (const column of columns) starts.push(starts.at(-1) + column.width);
  const widths = columns.map((column, index) => column.width - (index === 0 ? 5 : 10));
  return { starts, widths, total: columns.reduce((sum, column) => sum + column.width, 0) };
}

const MAIN_GEOMETRY = getColumnGeometry(MAIN_COLUMNS);
const SUPPLEMENT_GEOMETRY = getColumnGeometry(SUPPLEMENT_COLUMNS);

function rowFragments(lines, geometry, getValues, descriptionColumn) {
  const fragments = [];
  lines.forEach((line, index) => {
    const fullCells = getValues(line, index).map((value, column) =>
      wrapText(value, geometry.widths[column], TABLE_FONT));
    const maxLength = Math.max(...fullCells.map((cell) => cell.length));
    for (let offset = 0; offset < maxLength; offset += ROW_FRAGMENT_LINES) {
      const first = offset === 0;
      const cells = fullCells.map((cell, column) => {
        if (first || column === descriptionColumn || cell.length > offset) {
          return cell.slice(offset, offset + ROW_FRAGMENT_LINES);
        }
        return [];
      });
      if (!first) cells[0] = [`${index + 1} (cont.)`];
      const visibleLines = Math.max(...cells.map((cell) => cell.length));
      fragments.push({
        type: 'main',
        cells,
        height: visibleLines * TABLE_LINE_HEIGHT + ROW_PADDING * 2,
      });
    }
  });
  return fragments;
}

function makeMainUnits(model) {
  if (!model.lines.length) {
    return [{ type: 'main', empty: true, height: 32 }];
  }
  return rowFragments(model.lines, MAIN_GEOMETRY, (line, index) => [
    String(index + 1),
    line.productName,
    quantity(line.orderedQty),
    quantity(line.receivedQty),
    quantity(line.acceptedQty),
    quantity(line.balanceAfterQty),
    quantity(line.rejectedQty),
  ], 1);
}

function makeSupplementUnits(model) {
  if (!model.lines.length) {
    return [{ type: 'supplement', empty: true, height: 32 }];
  }
  return rowFragments(model.lines, SUPPLEMENT_GEOMETRY, (line, index) => [
    String(index + 1),
    line.lineId,
    line.productName,
    model.locationName,
    line.batchNo,
    line.expiryDate,
  ], 2).map((unit) => ({ ...unit, type: 'supplement' }));
}

function sectionHeaderHeight(type, hasLegacyBalance) {
  if (type === 'metadata') return 35;
  if (type === 'main') return 55;
  if (type === 'source') return 35;
  return hasLegacyBalance ? 78 : 62;
}

function pageCursor(page, finalPage, hasLegacyBalance) {
  let cursor = BODY_START_Y;
  let previousType = '';
  for (const unit of page.units) {
    if (unit.type !== previousType) {
      cursor += sectionHeaderHeight(unit.type, hasLegacyBalance);
      previousType = unit.type;
    }
    cursor += unit.height;
  }
  return cursor;
}

function packUnits(units, hasLegacyBalance) {
  const pages = [{ units: [] }];
  for (const unit of units) {
    let page = pages.at(-1);
    let next = [...page.units, unit];
    let cursor = pageCursor({ units: next }, false, hasLegacyBalance);
    if (cursor > NORMAL_END_Y && page.units.length) {
      page = { units: [] };
      pages.push(page);
      next = [unit];
      cursor = pageCursor({ units: next }, false, hasLegacyBalance);
    }
    if (cursor > NORMAL_END_Y) {
      throw new Error('Purchase Received document content cannot fit safely on an A4 page.');
    }
    page.units = next;
  }

  while (pages.length) {
    const last = pages.at(-1);
    if (pageCursor(last, true, hasLegacyBalance) <= FINAL_END_Y || !last.units.length) break;
    const tail = [];
    while (last.units.length) {
      const candidate = [last.units.at(-1), ...tail];
      if (pageCursor({ units: candidate }, true, hasLegacyBalance) > FINAL_END_Y) break;
      tail.unshift(last.units.pop());
    }
    if (!tail.length) {
      throw new Error('Purchase Received content leaves no room for the required certification and signatory block.');
    }
    pages.push({ units: tail });
    if (!last.units.length) pages.splice(pages.length - 2, 1);
    else break;
  }
  return pages.filter((page) => page.units.length);
}

function drawField(x, y, width, field) {
  const parts = [
    `<rect x="${x}" y="${y}" width="${width}" height="${fieldHeight(field)}" rx="1" fill="#ffffff" stroke="${COLORS.border}" stroke-width="0.8"/>`,
    textElement(x + 10, y + 14, field.labelLines.join(' '), {
      size: 7.2, fill: COLORS.muted, weight: 700, letterSpacing: 0.25,
    }),
    wrappedText(x + 10, y + 27 + (field.labelLines.length - 1) * 9,
      field.valueLines, { size: 8.7, fill: COLORS.ink, weight: 500, lineHeight: METADATA_LINE_HEIGHT }),
  ];
  return parts.join('');
}

function drawMetadataUnit(unit, y) {
  const gap = 10;
  const leftWidth = 334;
  const rightX = MARGIN + leftWidth + gap;
  const rightWidth = CONTENT_WIDTH - leftWidth - gap;
  const parts = [
    `<rect x="${MARGIN}" y="${y}" width="${leftWidth}" height="${unit.height}" rx="1" fill="#ffffff" stroke="${COLORS.border}" stroke-width="0.8"/>`,
    `<rect x="${rightX}" y="${y}" width="${rightWidth}" height="${unit.height}" rx="1" fill="#ffffff" stroke="${COLORS.border}" stroke-width="0.8"/>`,
  ];
  if (unit.leftField) parts.push(drawField(MARGIN + 1, y + 1, leftWidth - 2, unit.leftField));
  if (unit.rightField) parts.push(drawField(rightX + 1, y + 1, rightWidth - 2, unit.rightField));
  return parts.join('');
}

function drawMainHeading(y) {
  const parts = [
    textElement(MARGIN, y + 11, 'RECEIVED QUANTITY SUMMARY', {
      size: 9, fill: COLORS.ink, weight: 700, letterSpacing: 0.35,
    }),
    `<rect x="${MARGIN}" y="${y + 17}" width="${MAIN_GEOMETRY.total}" height="${TABLE_HEADER_HEIGHT}" fill="${COLORS.header}"/>`,
  ];
  MAIN_COLUMNS.forEach((column, index) => {
    const center = MAIN_GEOMETRY.starts[index] + column.width / 2;
    const lineHeight = 9;
    const firstY = y + 17 + (TABLE_HEADER_HEIGHT - (column.label.length - 1) * lineHeight) / 2 + 3;
    parts.push(wrappedText(center, firstY, column.label, {
      size: 7.5, fill: COLORS.headerText, weight: 700, anchor: 'middle', lineHeight,
    }));
    if (index) {
      parts.push(`<line x1="${MAIN_GEOMETRY.starts[index]}" y1="${y + 17}" x2="${MAIN_GEOMETRY.starts[index]}" y2="${y + 17 + TABLE_HEADER_HEIGHT}" stroke="${COLORS.grid}" stroke-opacity="0.9" stroke-width="0.7"/>`);
    }
  });
  return parts.join('');
}

function drawSupplementHeading(y, hasLegacyBalance) {
  const parts = [
    textElement(MARGIN, y + 11, 'RECEIPT TRACEABILITY', {
      size: 9, fill: COLORS.ink, weight: 700, letterSpacing: 0.35,
    }),
  ];
  let tableY = y + 17;
  if (hasLegacyBalance) {
    const note = 'Balance Qty is unavailable for legacy history when no after-receipt quantity was saved; it is shown as —.';
    const noteLines = wrapText(note, CONTENT_WIDTH - 18, 8);
    const noteHeight = noteLines.length * 10 + 8;
    parts.push(
      `<rect x="${MARGIN}" y="${tableY}" width="${CONTENT_WIDTH}" height="${noteHeight}" fill="#f8f9fa" stroke="${COLORS.grid}" stroke-width="0.7"/>`,
      wrappedText(MARGIN + 9, tableY + 13, noteLines, {
        size: 8, fill: COLORS.muted, lineHeight: 10,
      }),
    );
    tableY += noteHeight + 4;
  }
  parts.push(`<rect x="${MARGIN}" y="${tableY}" width="${SUPPLEMENT_GEOMETRY.total}" height="${TABLE_HEADER_HEIGHT}" fill="${COLORS.header}"/>`);
  SUPPLEMENT_COLUMNS.forEach((column, index) => {
    const center = SUPPLEMENT_GEOMETRY.starts[index] + column.width / 2;
    const lineHeight = 9;
    const firstY = tableY + (TABLE_HEADER_HEIGHT - (column.label.length - 1) * lineHeight) / 2 + 3;
    parts.push(wrappedText(center, firstY, column.label, {
      size: 7.5, fill: COLORS.headerText, weight: 700, anchor: 'middle', lineHeight,
    }));
    if (index) {
      parts.push(`<line x1="${SUPPLEMENT_GEOMETRY.starts[index]}" y1="${tableY}" x2="${SUPPLEMENT_GEOMETRY.starts[index]}" y2="${tableY + TABLE_HEADER_HEIGHT}" stroke="${COLORS.grid}" stroke-opacity="0.9" stroke-width="0.7"/>`);
    }
  });
  return parts.join('');
}

function drawSourceUnit(unit, y) {
  const leftWidth = 334;
  const rightX = MARGIN + leftWidth + 10;
  const rightWidth = CONTENT_WIDTH - leftWidth - 10;
  const parts = [
    `<rect x="${MARGIN}" y="${y}" width="${leftWidth}" height="${unit.height}" rx="1" fill="#ffffff" stroke="${COLORS.border}" stroke-width="0.8"/>`,
    `<rect x="${rightX}" y="${y}" width="${rightWidth}" height="${unit.height}" rx="1" fill="#ffffff" stroke="${COLORS.border}" stroke-width="0.8"/>`,
  ];
  if (unit.leftField) parts.push(drawField(MARGIN + 1, y + 1, leftWidth - 2, unit.leftField));
  if (unit.rightField) parts.push(drawField(rightX + 1, y + 1, rightWidth - 2, unit.rightField));
  return parts.join('');
}

function drawRows(unit, y, indexWithinPage) {
  const isSupplement = unit.type === 'supplement';
  const columns = isSupplement ? SUPPLEMENT_COLUMNS : MAIN_COLUMNS;
  const geometry = isSupplement ? SUPPLEMENT_GEOMETRY : MAIN_GEOMETRY;
  if (unit.empty) {
    const text = isSupplement
      ? 'No saved receipt line details.'
      : 'No saved receipt quantities.';
    return [
      `<rect x="${MARGIN}" y="${y}" width="${geometry.total}" height="${unit.height}" fill="#ffffff" stroke="${COLORS.grid}" stroke-width="0.7"/>`,
      textElement(MARGIN + 10, y + 20, text, { size: 8.5, fill: COLORS.muted }),
    ].join('');
  }
  const parts = [
    `<rect x="${MARGIN}" y="${y}" width="${geometry.total}" height="${unit.height}" fill="${indexWithinPage % 2 ? COLORS.highlight : '#ffffff'}"/>`,
    `<rect x="${MARGIN}" y="${y}" width="${geometry.total}" height="${unit.height}" fill="none" stroke="${COLORS.grid}" stroke-width="0.7"/>`,
  ];
  for (let column = 1; column < columns.length; column += 1) {
    parts.push(`<line x1="${geometry.starts[column]}" y1="${y}" x2="${geometry.starts[column]}" y2="${y + unit.height}" stroke="${COLORS.grid}" stroke-width="0.65"/>`);
  }
  unit.cells.forEach((lines, column) => {
    if (!lines.length) return;
    const centered = column === 0 || (!isSupplement && column > 1) || (isSupplement && column === 1);
    const x = centered
      ? geometry.starts[column] + columns[column].width / 2
      : geometry.starts[column] + 5;
    parts.push(wrappedText(x, y + ROW_PADDING + TABLE_FONT, lines, {
      size: TABLE_FONT, fill: COLORS.ink,
      weight: column === 1 && !isSupplement ? 500 : 400,
      anchor: centered ? 'middle' : 'start',
      lineHeight: TABLE_LINE_HEIGHT,
    }));
  });
  return parts.join('');
}

function drawFinalSignatory() {
  const top = 822;
  const boxX = 466;
  const boxY = 852;
  const boxWidth = PAGE_WIDTH - MARGIN - boxX;
  const boxHeight = 178;
  return [
    textElement(MARGIN, top, 'Certified that the particulars given above are true and correct.', {
      size: 8.8, fill: COLORS.ink,
    }),
    `<rect x="${boxX}" y="${boxY}" width="${boxWidth}" height="${boxHeight}" fill="#ffffff" stroke="${COLORS.grid}" stroke-width="0.9"/>`,
    textElement(boxX + boxWidth / 2, boxY + 27, `For ${COMPANY.name}`, {
      size: 7.2, fill: COLORS.ink, weight: 700, anchor: 'middle', letterSpacing: 0.6,
    }),
    textElement(boxX + boxWidth / 2, boxY + 47, 'UNSIGNED · SIGNATURE PLACEHOLDER', {
      size: 6.4, fill: COLORS.muted, weight: 600, anchor: 'middle', letterSpacing: 0.35,
    }),
    `<line x1="${boxX + 18}" y1="${boxY + 132}" x2="${boxX + boxWidth - 18}" y2="${boxY + 132}" stroke="${COLORS.grid}" stroke-width="0.8"/>`,
    textElement(boxX + boxWidth / 2, boxY + 157, 'Authorised Signatory', {
      size: 8, fill: COLORS.ink, weight: 700, anchor: 'middle', letterSpacing: 0.5,
    }),
  ].join('');
}

function drawFooter(pageIndex, pageCount, finalPage) {
  const parts = [
    `<line x1="${MARGIN}" y1="1077" x2="${PAGE_WIDTH - MARGIN}" y2="1077" stroke="${COLORS.grid}" stroke-width="0.8"/>`,
    textElement(MARGIN, 1092, 'Saved receipt details only · No inventory quantities are posted', {
      size: 7.7, fill: COLORS.muted,
    }),
    textElement(PAGE_WIDTH - MARGIN, 1092, `Page ${pageIndex + 1} of ${pageCount}`, {
      size: 7.7, fill: COLORS.muted, anchor: 'end',
    }),
  ];
  if (finalPage) parts.unshift(drawFinalSignatory());
  return parts.join('');
}

function renderPage(model, page, pageIndex, pageCount, hasLegacyBalance) {
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" viewBox="0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}" role="img" aria-label="Purchase Received ${escapeXml(model.number)}, page ${pageIndex + 1} of ${pageCount}">`,
    drawPageHeader(model, pageIndex, pageCount),
  ];
  let y = BODY_START_Y;
  let previousType = '';
  let sectionRows = 0;
  for (const unit of page.units) {
    if (unit.type !== previousType) {
      if (unit.type === 'metadata') {
        parts.push(
          textElement(MARGIN + 10, y + 12, 'SUPPLIER', {
            size: 7.3, fill: COLORS.muted, weight: 700, letterSpacing: 0.55,
          }),
          textElement(MARGIN + 344, y + 12, 'RECEIPT & ORDER DETAILS', {
            size: 7.3, fill: COLORS.muted, weight: 700, letterSpacing: 0.55,
          }),
        );
        y += 35;
      } else if (unit.type === 'main') {
        parts.push(drawMainHeading(y));
        y += sectionHeaderHeight('main', hasLegacyBalance);
        sectionRows = 0;
      } else if (unit.type === 'source') {
        parts.push(
          textElement(MARGIN + 10, y + 12, 'ORDER & RECEIVER', {
            size: 7.3, fill: COLORS.muted, weight: 700, letterSpacing: 0.55,
          }),
          textElement(MARGIN + 344, y + 12, 'DESTINATION & VENDOR', {
            size: 7.3, fill: COLORS.muted, weight: 700, letterSpacing: 0.55,
          }),
        );
        y += sectionHeaderHeight('source', hasLegacyBalance);
        sectionRows = 0;
      } else {
        parts.push(drawSupplementHeading(y, hasLegacyBalance));
        y += sectionHeaderHeight('supplement', hasLegacyBalance);
        sectionRows = 0;
      }
      previousType = unit.type;
    }
    if (unit.type === 'metadata') parts.push(drawMetadataUnit(unit, y));
    else if (unit.type === 'source') parts.push(drawSourceUnit(unit, y));
    else parts.push(drawRows(unit, y, sectionRows++));
    y += unit.height;
  }
  parts.push(drawFooter(pageIndex, pageCount, pageIndex === pageCount - 1), '</svg>');
  return parts.join('');
}

/**
 * Render a saved Purchase Received model into reference-style Classic A4 SVG pages.
 * No prices, tax figures, product-master lookups, or unsaved values are introduced.
 */
export function renderPRReceiptPages(model, templateId = 'classic') {
  if (templateId !== 'classic') {
    throw new Error('Unsupported Purchase Received template. Choose the Classic template.');
  }
  const normalized = normalizeModel(model);
  const legacyBalance = normalized.lines.some((line) => line.balanceAfterQty === null);
  const units = [
    ...makeMetadataUnits(normalized),
    ...makeMainUnits(normalized),
    ...makeSourceUnits(normalized),
    ...makeSupplementUnits(normalized),
  ];
  const pages = packUnits(units, legacyBalance);
  return pages.map((page, index) =>
    renderPage(normalized, page, index, pages.length, legacyBalance));
}