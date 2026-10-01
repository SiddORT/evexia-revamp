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

const THEMES = {
  classic: {
    id: 'classic',
    margin: MARGIN,
    bodyStartY: BODY_START_Y,
    normalEndY: NORMAL_END_Y,
    finalEndY: FINAL_END_Y,
    tableHeaderHeight: 38,
    tableFont: 8.6,
    tableLineHeight: 10.8,
    rowPadding: 5,
    rowFragmentLines: 7,
    metadataLineHeight: 11.4,
    metadataUnitMinHeight: 54,
    metadataLeftRatio: 334 / 706,
    metadataPanelPad: 10,
    metadataHeaderHeight: 35,
    sourceHeaderHeight: 35,
    mainHeaderHeight: 55,
    supplementHeaderHeight: 62,
    emptyRowHeight: 32,
    companyBottom: 119,
    logoWidth: 142,
    logoHeight: 70,
    companyFont: 9.3,
    metaFont: 8.2,
    headerIdFont: 8,
    headerIdLineHeight: 9.5,
    colors: COLORS,
  },
  modern: {
    id: 'modern',
    margin: 44,
    bodyStartY: 0,
    normalEndY: 1054,
    finalEndY: 785,
    tableHeaderHeight: 40,
    tableFont: 9,
    tableLineHeight: 11.4,
    rowPadding: 6,
    rowFragmentLines: 7,
    metadataLineHeight: 12.4,
    metadataUnitMinHeight: 62,
    emptyRowHeight: 36,
    metadataLabelWidth: 210,
    metadataLabelFont: 7.8,
    metadataLabelLineHeight: 10,
    metadataValueFont: 9.3,
    metadataValueTop: 29,
    metadataFieldBaseHeight: 27,
    metadataFieldBottomPad: 8,
    metadataPanelRadius: 8,
    metadataCardRadius: 5,
    metadataLeftRatio: 0.48,
    metadataPanelPad: 12,
    metadataHeaderHeight: 42,
    sourceHeaderHeight: 42,
    mainHeaderHeight: 57,
    supplementHeaderHeight: 57,
    companyBottom: 118,
    logoWidth: 144,
    logoHeight: 68,
    companyFont: 10.2,
    metaFont: 9.5,
    headerIdFont: 8.8,
    headerIdLineHeight: 10.5,
    headerColors: { company: '#ffffff', detail: '#ffffff', page: '#dceaf5' },
    colors: {
      ink: '#16263a', muted: '#52657b', border: '#bfd0df', grid: '#d8e3ed',
      header: '#e9f1f8', headerText: '#183c60', highlight: '#f1f6fa',
      accent: '#183c60', accentText: '#ffffff', card: '#f7fafc',
      page: '#ffffff', warning: '#a4342e', warningFill: '#fff0ed',
    },
  },
  compact: {
    id: 'compact',
    margin: 38,
    bodyStartY: 0,
    normalEndY: 1054,
    finalEndY: 785,
    tableHeaderHeight: 32,
    tableFont: 8.2,
    tableLineHeight: 9.8,
    rowPadding: 4,
    rowFragmentLines: 7,
    metadataLineHeight: 9.8,
    metadataUnitMinHeight: 45,
    emptyRowHeight: 28,
    metadataLabelWidth: 185,
    metadataLabelFont: 7.2,
    metadataLabelLineHeight: 8.2,
    metadataValueFont: 8.2,
    metadataValueTop: 24,
    metadataFieldBaseHeight: 20,
    metadataFieldBottomPad: 4,
    metadataPanelRadius: 3,
    metadataCardRadius: 2,
    metadataLeftRatio: 0.48,
    metadataPanelPad: 8,
    metadataHeaderHeight: 31,
    sourceHeaderHeight: 31,
    mainHeaderHeight: 47,
    supplementHeaderHeight: 47,
    companyBottom: 99,
    logoWidth: 118,
    logoHeight: 56,
    companyFont: 9.2,
    metaFont: 8.8,
    headerIdFont: 8.2,
    headerIdLineHeight: 9.2,
    headerColors: { company: '#26343a', detail: '#526168', page: '#526168' },
    colors: {
      ink: '#26343a', muted: '#526168', border: '#aebbc1', grid: '#cbd4d8',
      header: '#e4f3f1', headerText: '#087c78', highlight: '#f1f8f7',
      accent: '#087c78', accentText: '#ffffff', card: '#fbfdfd',
      page: '#ffffff', warning: '#a4342e', warningFill: '#fff0ed',
    },
  },
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

function conservativeGlyphWidth(character) {
  if (character === ' ') return 0.29;
  if ('ilI.,:;!\'|'.includes(character)) return 0.3;
  if ('()[]{}'.includes(character)) return 0.38;
  if ('frt'.includes(character)) return 0.4;
  if (character === 'W') return 0.96;
  if (character === 'M') return 0.84;
  if (character === 'w') return 0.76;
  if (character === 'm') return 0.86;
  if (/[A-Z]/.test(character)) return 0.7;
  if (/[a-z]/.test(character)) return 0.57;
  if (/[0-9]/.test(character)) return 0.59;
  if (character.codePointAt(0) > 0x7f) return 1;
  return 0.76;
}

function wrapThemeText(value, width, fontSize, theme, letterSpacing = 0) {
  if (theme.id === 'classic') return wrapText(value, width, fontSize);
  const text = safeText(value);
  const maxUnits = width / fontSize;
  const measuredWidth = (valueToMeasure) => {
    const characters = Array.from(valueToMeasure);
    const glyphUnits = characters.reduce((sum, character) =>
      sum + conservativeGlyphWidth(character) + 0.035, 0);
    const spacingUnits = Math.max(0, characters.length - 1) * (letterSpacing / fontSize);
    return (glyphUnits + spacingUnits) * 1.08;
  };
  const result = [];

  for (const originalLine of text.split(/\r?\n/)) {
    const words = originalLine.split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words.length ? words : ['']) {
      const pieces = [];
      let piece = '';
      for (const character of Array.from(word)) {
        if (piece && measuredWidth(piece + character) > maxUnits) {
          pieces.push(piece);
          piece = '';
        }
        piece += character;
      }
      if (piece || !pieces.length) pieces.push(piece);
      for (const part of pieces) {
        const candidate = line ? `${line} ${part}` : part;
        if (measuredWidth(candidate) > maxUnits && line) {
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

function drawPageHeader(model, pageIndex, pageCount, theme, layout) {
  if (theme.id !== 'classic') {
    return drawThemedPageHeader(model, pageIndex, pageCount, theme, layout);
  }
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

function receiptMarkings(model) {
  const markings = ['LOCAL DEMO · NOT A STOCK-LEDGER ENTRY'];
  if (model.status.toLowerCase() === 'deleted' || model.deletedAt !== DASH) {
    markings.push('DELETED · FOR REFERENCE');
  }
  if (model.isSample) markings.push('SAMPLE · PREVIEW ONLY');
  return markings;
}

function makeHeaderLayout(model, theme, contentWidth) {
  const companyBottom = theme.companyBottom;
  const ids = `PR ${model.number}  ·  PO ${model.poNumber}`;
  const idWidth = contentWidth - 180;
  const idLines = wrapThemeText(ids, idWidth, theme.headerIdFont, theme);
  const baseY = companyBottom + (theme.id === 'modern' ? 16 : 15);
  const pageY = baseY + idLines.length * theme.headerIdLineHeight + 2;
  const markings = receiptMarkings(model).map((text) => ({
    text,
    warning: text.startsWith('DELETED') || text.startsWith('SAMPLE'),
    width: Math.min(contentWidth, Math.max(185, text.length * 5.15 + 20)),
  }));
  const rows = [];
  let row = [];
  let rowWidth = 0;
  for (const marking of markings) {
    if (row.length && rowWidth + marking.width + 7 > contentWidth) {
      rows.push(row);
      row = [];
      rowWidth = 0;
    }
    row.push({ ...marking, xOffset: rowWidth });
    rowWidth += marking.width + 7;
  }
  if (row.length) rows.push(row);
  const markingsY = pageY + 5;
  return {
    companyBottom, idLines, idWidth, baseY, pageY, rows, markingsY,
    bodyStartY: markingsY + rows.length * 26 + 8,
  };
}

function prepareLayout(model, baseTheme) {
  const margin = baseTheme.margin;
  const contentWidth = PAGE_WIDTH - margin * 2;
  const theme = baseTheme.id === 'classic'
    ? { ...baseTheme, colors: { ...COLORS, page: '#ffffff', card: '#ffffff', accent: COLORS.ink } }
    : baseTheme;
  const metadataGap = 10;
  const metadataLeftWidth = theme.id === 'classic'
    ? 334
    : Math.round((contentWidth - metadataGap) * theme.metadataLeftRatio);
  const metadataRightWidth = contentWidth - metadataLeftWidth - metadataGap;
  const mainGeometry = getColumnGeometry(MAIN_COLUMNS, margin, contentWidth);
  const supplementGeometry = getColumnGeometry(SUPPLEMENT_COLUMNS, margin, contentWidth);
  const headerLayout = theme.id === 'classic'
    ? null
    : makeHeaderLayout(model, theme, contentWidth);
  const legacyNoteFont = theme.id === 'modern' ? 8.2 : 7.6;
  const legacyNoteLineHeight = theme.id === 'modern' ? 10.5 : 9;
  const legacyNote = 'Balance Qty is unavailable for legacy history when no after-receipt quantity was saved; it is shown as —.';
  const legacyNoteHeight = theme.id === 'classic'
    ? 0
    : wrapThemeText(legacyNote, contentWidth - 18, legacyNoteFont, theme).length * legacyNoteLineHeight + 7;
  return {
    ...theme,
    margin,
    contentWidth,
    bodyStartY: headerLayout?.bodyStartY ?? BODY_START_Y,
    metadataGap,
    metadataLeftWidth,
    metadataRightWidth,
    leftFieldWidth: theme.id === 'classic' ? 300 : metadataLeftWidth - 34,
    rightFieldWidth: theme.id === 'classic' ? 330 : metadataRightWidth - 32,
    mainGeometry,
    supplementGeometry,
    headerLayout,
    legacyNoteHeight,
    legacyNoteFont,
    legacyNoteLineHeight,
  };
}

function drawThemedPageHeader(model, pageIndex, pageCount, theme, layout) {
  const colors = theme.colors;
  const { margin } = layout;
  const header = layout.headerLayout;
  const companyX = margin + theme.logoWidth + 22;
  const companyWidth = PAGE_WIDTH - margin - companyX;
  const companyFields = [
    { text: COMPANY.name, size: theme.companyFont + 1, weight: 700, gap: 2 },
    { text: COMPANY.address, size: theme.metaFont, weight: 400, gap: 2 },
    { text: COMPANY.email, size: theme.metaFont, weight: 400, gap: 2 },
    { text: COMPANY.website, size: theme.metaFont, weight: 400, gap: 0 },
  ];
  const modern = theme.id === 'modern';
  const parts = [
    `<rect x="0" y="0" width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" fill="${colors.page}"/>`,
  ];
  if (modern) {
    parts.push(
      `<rect x="0" y="0" width="${PAGE_WIDTH}" height="${theme.companyBottom}" fill="${colors.accent}"/>`,
      `<rect x="0" y="${theme.companyBottom}" width="${PAGE_WIDTH}" height="2" fill="#20b5a8"/>`,
    );
  } else {
    parts.push(`<line x1="${margin}" y1="${theme.companyBottom}" x2="${PAGE_WIDTH - margin}" y2="${theme.companyBottom}" stroke="${colors.accent}" stroke-width="1.4"/>`);
  }
  parts.push(
    `<rect x="${margin}" y="${modern ? 25 : 20}" width="${theme.logoWidth}" height="${theme.logoHeight}" rx="${modern ? 2 : 1}" fill="#ffffff" stroke="${colors.border}" stroke-width="0.8"/>`,
    `<image x="${margin + 5}" y="${(modern ? 25 : 20) + 5}" width="${theme.logoWidth - 10}" height="${theme.logoHeight - 10}" href="${LOGO_PLACEHOLDER}" preserveAspectRatio="xMidYMid meet"/>`,
  );
  let companyY = modern ? 37 : 27;
  for (const field of companyFields) {
    const lines = wrapThemeText(field.text, companyWidth, field.size, theme);
    parts.push(wrappedText(companyX, companyY, lines, {
      size: field.size,
      fill: field.weight === 700 ? theme.headerColors.company : theme.headerColors.detail,
      weight: field.weight,
      lineHeight: field.size * (modern ? 1.25 : 1.2),
    }));
    companyY += lines.length * field.size * (modern ? 1.25 : 1.2) + field.gap;
  }
  parts.push(
    textElement(margin, header.baseY, 'PURCHASE RECEIVED', {
      size: theme.metaFont - 0.2, fill: colors.accent, weight: 700, letterSpacing: 0.55,
    }),
    wrappedText(PAGE_WIDTH - margin, header.baseY, header.idLines, {
      size: theme.headerIdFont,
      fill: colors.ink,
      weight: 600,
      anchor: 'end',
      lineHeight: theme.headerIdLineHeight,
    }),
    textElement(PAGE_WIDTH - margin, header.pageY, `Page ${pageIndex + 1} of ${pageCount}`, {
      size: 7.8, fill: theme.headerColors.page, anchor: 'end',
    }),
  );
  for (const [rowIndex, row] of header.rows.entries()) {
    for (const marking of row) {
      const fill = marking.warning ? colors.warningFill : colors.header;
      const stroke = marking.warning ? colors.warning : colors.border;
      const textFill = marking.warning ? colors.warning : colors.headerText;
      const x = margin + marking.xOffset;
      parts.push(
        `<rect x="${x}" y="${header.markingsY + rowIndex * 26}" width="${marking.width}" height="21" rx="${modern ? 7 : 2}" fill="${fill}" stroke="${stroke}" stroke-width="0.8"/>`,
        textElement(x + marking.width / 2, header.markingsY + rowIndex * 26 + 14, marking.text, {
          size: 7.3, fill: textFill, weight: 700, anchor: 'middle',
        }),
      );
    }
  }
  return parts.join('');
}

function splitField(label, value, width, theme) {
  const lines = wrapThemeText(value, width, theme.metadataValueFont || 8.7, theme);
  const fields = [];
  for (let offset = 0; offset < lines.length; offset += ROW_FRAGMENT_LINES) {
    const part = offset / ROW_FRAGMENT_LINES;
    const fieldLabel = part ? `${label} (continued)` : label;
    const labelWidth = theme.metadataLabelWidth
      ? Math.min(width, theme.metadataLabelWidth)
      : width;
    fields.push({
      label: fieldLabel,
      labelLines: wrapThemeText(
        fieldLabel, labelWidth, theme.metadataLabelFont || 7.2, theme, theme.id === 'classic' ? 0 : 0.2),
      valueLines: lines.slice(offset, offset + ROW_FRAGMENT_LINES),
    });
  }
  return fields;
}

function fieldHeight(field, theme = THEMES.classic) {
  if (!field) return 0;
  if (theme.id !== 'classic') {
    return theme.metadataFieldBaseHeight +
      field.labelLines.length * theme.metadataLabelLineHeight +
      field.valueLines.length * theme.metadataLineHeight +
      theme.metadataFieldBottomPad;
  }
  return 24 + field.labelLines.length * 9 + field.valueLines.length * METADATA_LINE_HEIGHT + 5;
}

function makeMetadataUnits(model, theme, layout) {
  const leftFields = [
    ['Vendor', model.vendorName],
    ['Address', model.vendorAddress],
    ['GST No.', model.vendorGstNo],
  ];
  const rightFields = [
    ['PR Number', model.number],
    ['PR Date', model.receivedDate],
  ];
  const left = leftFields.flatMap(([label, value]) =>
    splitField(label, value, layout.leftFieldWidth, theme));
  const right = rightFields.flatMap(([label, value]) =>
    splitField(label, value, layout.rightFieldWidth, theme));
  return Array.from({ length: Math.max(left.length, right.length) }, (_, index) => {
    const leftField = left[index] || null;
    const rightField = right[index] || null;
    return {
      type: 'metadata',
      leftField,
      rightField,
      height: Math.max(fieldHeight(leftField, theme), fieldHeight(rightField, theme), theme.metadataUnitMinHeight),
    };
  });
}

function makeSourceUnits(model, theme, layout) {
  const leftFields = [
    ['Linked PO Number', model.poNumber],
    ['Receiver (recorded only; identity not independently verified)', model.receivedBy],
    ['Vendor Phone', model.vendorPhone],
  ];
  const rightFields = [
    ['Linked PO Date', model.poDate],
    ['Destination', model.locationName],
  ];
  const left = leftFields.flatMap(([label, value]) =>
    splitField(label, value, layout.leftFieldWidth, theme));
  const right = rightFields.flatMap(([label, value]) =>
    splitField(label, value, layout.rightFieldWidth, theme));
  return Array.from({ length: Math.max(left.length, right.length) }, (_, index) => {
    const leftField = left[index] || null;
    const rightField = right[index] || null;
    return {
      type: 'source',
      leftField,
      rightField,
      height: Math.max(fieldHeight(leftField, theme), fieldHeight(rightField, theme), theme.metadataUnitMinHeight),
    };
  });
}

function getColumnGeometry(columns, margin = MARGIN, contentWidth = CONTENT_WIDTH) {
  const sourceWidth = columns.reduce((sum, column) => sum + column.width, 0);
  const scale = contentWidth / sourceWidth;
  const scaledColumns = columns.map((column) => ({ ...column, width: column.width * scale }));
  const starts = [margin];
  for (const column of scaledColumns) starts.push(starts.at(-1) + column.width);
  const widths = scaledColumns.map((column, index) => column.width - (index === 0 ? 5 : 10));
  return { starts, widths, columns: scaledColumns, total: contentWidth };
}

const MAIN_GEOMETRY = getColumnGeometry(MAIN_COLUMNS);
const SUPPLEMENT_GEOMETRY = getColumnGeometry(SUPPLEMENT_COLUMNS);

function rowFragments(lines, geometry, getValues, descriptionColumn, theme) {
  const fragments = [];
  lines.forEach((line, index) => {
    const fullCells = getValues(line, index).map((value, column) =>
      wrapThemeText(value, geometry.widths[column], theme.tableFont, theme));
    const maxLength = Math.max(...fullCells.map((cell) => cell.length));
    for (let offset = 0; offset < maxLength; offset += theme.rowFragmentLines) {
      const first = offset === 0;
      const cells = fullCells.map((cell, column) => {
        if (first || column === descriptionColumn || cell.length > offset) {
          return cell.slice(offset, offset + theme.rowFragmentLines);
        }
        return [];
      });
      if (!first) cells[0] = [`${index + 1} (cont.)`];
      const visibleLines = Math.max(...cells.map((cell) => cell.length));
      fragments.push({
        type: 'main',
        cells,
        height: visibleLines * theme.tableLineHeight + theme.rowPadding * 2,
      });
    }
  });
  return fragments;
}

function makeMainUnits(model, geometry, theme) {
  if (!model.lines.length) {
    return [{ type: 'main', empty: true, height: theme.emptyRowHeight }];
  }
  return rowFragments(model.lines, geometry, (line, index) => [
    String(index + 1),
    line.productName,
    quantity(line.orderedQty),
    quantity(line.receivedQty),
    quantity(line.acceptedQty),
    quantity(line.balanceAfterQty),
    quantity(line.rejectedQty),
  ], 1, theme);
}

function makeSupplementUnits(model, geometry, theme) {
  if (!model.lines.length) {
    return [{ type: 'supplement', empty: true, height: theme.emptyRowHeight }];
  }
  return rowFragments(model.lines, geometry, (line, index) => [
    String(index + 1),
    line.lineId,
    line.productName,
    model.locationName,
    line.batchNo,
    line.expiryDate,
  ], 2, theme).map((unit) => ({ ...unit, type: 'supplement' }));
}

function sectionHeaderHeight(type, hasLegacyBalance, theme) {
  if (theme.id === 'classic') {
    if (type === 'metadata') return 35;
    if (type === 'main') return 55;
    if (type === 'source') return 35;
    return hasLegacyBalance ? 78 : 62;
  }
  if (type === 'metadata') return theme.metadataHeaderHeight;
  if (type === 'main') return theme.mainHeaderHeight;
  if (type === 'source') return theme.sourceHeaderHeight;
  if (!hasLegacyBalance) return theme.supplementHeaderHeight;
  return 17 + theme.legacyNoteHeight + 4 + theme.tableHeaderHeight;
}

function pageCursor(page, finalPage, hasLegacyBalance, theme) {
  let cursor = theme.bodyStartY;
  let previousType = '';
  for (const unit of page.units) {
    if (unit.type !== previousType) {
      cursor += sectionHeaderHeight(unit.type, hasLegacyBalance, theme);
      previousType = unit.type;
    }
    cursor += unit.height;
  }
  return cursor;
}

function packUnits(units, hasLegacyBalance, theme) {
  const pages = [{ units: [] }];
  for (const unit of units) {
    let page = pages.at(-1);
    let next = [...page.units, unit];
    let cursor = pageCursor({ units: next }, false, hasLegacyBalance, theme);
    if (cursor > theme.normalEndY && page.units.length) {
      page = { units: [] };
      pages.push(page);
      next = [unit];
      cursor = pageCursor({ units: next }, false, hasLegacyBalance, theme);
    }
    if (cursor > theme.normalEndY) {
      throw new Error('Purchase Received document content cannot fit safely on an A4 page.');
    }
    page.units = next;
  }

  while (pages.length) {
    const last = pages.at(-1);
    if (pageCursor(last, true, hasLegacyBalance, theme) <= theme.finalEndY || !last.units.length) break;
    const tail = [];
    while (last.units.length) {
      const candidate = [last.units.at(-1), ...tail];
      if (pageCursor({ units: candidate }, true, hasLegacyBalance, theme) > theme.finalEndY) break;
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

function drawField(x, y, width, field, theme) {
  const colors = theme.colors;
  if (theme.id === 'classic') {
    const parts = [
      `<rect x="${x}" y="${y}" width="${width}" height="${fieldHeight(field, theme)}" rx="1" fill="#ffffff" stroke="${colors.border}" stroke-width="0.8"/>`,
      textElement(x + 10, y + 14, field.labelLines.join(' '), {
        size: 7.2, fill: colors.muted, weight: 700, letterSpacing: 0.25,
      }),
      wrappedText(x + 10, y + 27 + (field.labelLines.length - 1) * 9,
        field.valueLines, { size: 8.7, fill: colors.ink, weight: 500, lineHeight: METADATA_LINE_HEIGHT }),
    ];
    return parts.join('');
  }
  const parts = [
    `<rect x="${x}" y="${y}" width="${width}" height="${fieldHeight(field, theme)}" rx="${theme.metadataCardRadius}" fill="${colors.card}" stroke="${colors.border}" stroke-width="0.75"/>`,
    wrappedText(x + theme.metadataPanelPad, y + 14, field.labelLines, {
      size: theme.metadataLabelFont, fill: colors.muted, weight: 700,
      letterSpacing: 0.2, lineHeight: theme.metadataLabelLineHeight,
    }),
    wrappedText(x + theme.metadataPanelPad,
      y + theme.metadataValueTop + (field.labelLines.length - 1) * theme.metadataLabelLineHeight,
      field.valueLines, {
        size: theme.metadataValueFont, fill: colors.ink, weight: 500,
        lineHeight: theme.metadataLineHeight,
      }),
  ];
  return parts.join('');
}

function drawMetadataUnit(unit, y, theme, layout) {
  const { margin, contentWidth, metadataLeftWidth, metadataRightWidth, metadataGap } = layout;
  const gap = 10;
  const leftWidth = theme.id === 'classic' ? 334 : metadataLeftWidth;
  const rightX = margin + leftWidth + (theme.id === 'classic' ? gap : metadataGap);
  const rightWidth = theme.id === 'classic' ? contentWidth - leftWidth - gap : metadataRightWidth;
  const panelFill = theme.id === 'classic' ? '#ffffff' : theme.colors.card;
  const parts = [
    `<rect x="${margin}" y="${y}" width="${leftWidth}" height="${unit.height}" rx="${theme.metadataPanelRadius || 1}" fill="${panelFill}" stroke="${theme.colors.border}" stroke-width="0.8"/>`,
    `<rect x="${rightX}" y="${y}" width="${rightWidth}" height="${unit.height}" rx="${theme.metadataPanelRadius || 1}" fill="${panelFill}" stroke="${theme.colors.border}" stroke-width="0.8"/>`,
  ];
  if (unit.leftField) parts.push(drawField(margin + 1, y + 1, leftWidth - 2, unit.leftField, theme));
  if (unit.rightField) parts.push(drawField(rightX + 1, y + 1, rightWidth - 2, unit.rightField, theme));
  return parts.join('');
}

function drawMainHeading(y, theme, layout) {
  const colors = theme.colors;
  const { margin } = layout;
  const geometry = layout.mainGeometry;
  const columns = geometry.columns;
  const tableHeight = theme.tableHeaderHeight;
  const titleSize = theme.id === 'classic' ? 9 : theme.id === 'modern' ? 10 : 8.8;
  const titleY = theme.id === 'classic' ? y + 11 : y + 12;
  const tableY = theme.id === 'classic' ? y + 17 : y + 17;
  const parts = [
    textElement(margin, titleY, 'RECEIVED QUANTITY SUMMARY', {
      size: titleSize, fill: theme.id === 'classic' ? colors.ink : colors.accent,
      weight: 700, letterSpacing: 0.35,
    }),
    (theme.id === 'classic'
      ? `<rect x="${margin}" y="${tableY}" width="${geometry.total}" height="${tableHeight}" fill="${colors.header}"/>`
      : `<rect x="${margin}" y="${tableY}" width="${geometry.total}" height="${tableHeight}" rx="${theme.metadataPanelRadius}" fill="${colors.header}"/>`),
  ];
  columns.forEach((column, index) => {
    const center = geometry.starts[index] + column.width / 2;
    const lineHeight = theme.id === 'classic' ? 9 : theme.tableFont * 1.15;
    const firstY = tableY + (tableHeight - (column.label.length - 1) * lineHeight) / 2 +
      (theme.id === 'classic' ? 3 : theme.tableFont * 0.35);
    parts.push(wrappedText(center, firstY, column.label, {
      size: theme.id === 'classic' ? 7.5 : theme.tableFont - 0.7,
      fill: colors.headerText, weight: 700, anchor: 'middle', lineHeight,
    }));
    if (index) {
      parts.push(`<line x1="${geometry.starts[index]}" y1="${tableY}" x2="${geometry.starts[index]}" y2="${tableY + tableHeight}" stroke="${colors.grid}" stroke-opacity="0.9" stroke-width="0.7"/>`);
    }
  });
  return parts.join('');
}

function drawSupplementHeading(y, hasLegacyBalance, theme, layout) {
  const { margin, contentWidth } = layout;
  const geometry = layout.supplementGeometry;
  const colors = theme.colors;
  const isClassic = theme.id === 'classic';
  const parts = [
    textElement(margin, y + (isClassic ? 11 : 12), 'RECEIPT TRACEABILITY', {
      size: isClassic ? 9 : theme.id === 'modern' ? 10 : 8.8,
      fill: isClassic ? colors.ink : colors.accent, weight: 700, letterSpacing: 0.35,
    }),
  ];
  let tableY = y + 17;
  if (hasLegacyBalance) {
    const note = 'Balance Qty is unavailable for legacy history when no after-receipt quantity was saved; it is shown as —.';
    const noteFont = isClassic ? 8 : theme.id === 'modern' ? 8.2 : 7.6;
    const noteLineHeight = isClassic ? 10 : theme.id === 'modern' ? 10.5 : 9;
    const noteLines = wrapThemeText(note, contentWidth - 18, noteFont, theme);
    const noteHeight = noteLines.length * noteLineHeight + (isClassic ? 8 : 7);
    const noteFill = isClassic ? '#f8f9fa' : colors.header;
    parts.push(
      (isClassic
        ? `<rect x="${margin}" y="${tableY}" width="${contentWidth}" height="${noteHeight}" fill="${noteFill}" stroke="${colors.grid}" stroke-width="0.7"/>`
        : `<rect x="${margin}" y="${tableY}" width="${contentWidth}" height="${noteHeight}" rx="${theme.metadataPanelRadius}" fill="${noteFill}" stroke="${colors.grid}" stroke-width="0.7"/>`),
      wrappedText(margin + 9, tableY + 13, noteLines, {
        size: noteFont, fill: colors.muted, lineHeight: noteLineHeight,
      }),
    );
    tableY += noteHeight + 4;
  }
  const headerHeight = theme.tableHeaderHeight;
  parts.push(isClassic
    ? `<rect x="${margin}" y="${tableY}" width="${geometry.total}" height="${headerHeight}" fill="${colors.header}"/>`
    : `<rect x="${margin}" y="${tableY}" width="${geometry.total}" height="${headerHeight}" rx="${theme.metadataPanelRadius}" fill="${colors.header}"/>`);
  geometry.columns.forEach((column, index) => {
    const center = geometry.starts[index] + column.width / 2;
    const lineHeight = isClassic ? 9 : theme.tableFont * 1.15;
    const firstY = tableY + (headerHeight - (column.label.length - 1) * lineHeight) / 2 +
      (isClassic ? 3 : theme.tableFont * 0.35);
    parts.push(wrappedText(center, firstY, column.label, {
      size: isClassic ? 7.5 : theme.tableFont - 0.7,
      fill: colors.headerText, weight: 700, anchor: 'middle', lineHeight,
    }));
    if (index) {
      parts.push(`<line x1="${geometry.starts[index]}" y1="${tableY}" x2="${geometry.starts[index]}" y2="${tableY + headerHeight}" stroke="${colors.grid}" stroke-opacity="0.9" stroke-width="0.7"/>`);
    }
  });
  return parts.join('');
}

function drawSourceUnit(unit, y, theme, layout) {
  return drawMetadataUnit(unit, y, theme, layout);
}

function drawRows(unit, y, indexWithinPage, theme, layout) {
  const isSupplement = unit.type === 'supplement';
  const columns = isSupplement ? layout.supplementGeometry.columns : layout.mainGeometry.columns;
  const geometry = isSupplement ? layout.supplementGeometry : layout.mainGeometry;
  const { margin } = layout;
  const colors = theme.colors;
  if (unit.empty) {
    const text = isSupplement
      ? 'No saved receipt line details.'
      : 'No saved receipt quantities.';
    return [
      `<rect x="${margin}" y="${y}" width="${geometry.total}" height="${unit.height}" fill="${colors.page}" stroke="${colors.grid}" stroke-width="0.7"/>`,
      textElement(margin + 10, y + 20, text, {
        size: theme.id === 'classic' ? 8.5 : theme.tableFont, fill: colors.muted,
      }),
    ].join('');
  }
  const parts = [
    `<rect x="${margin}" y="${y}" width="${geometry.total}" height="${unit.height}" fill="${indexWithinPage % 2 ? colors.highlight : colors.page}"/>`,
    `<rect x="${margin}" y="${y}" width="${geometry.total}" height="${unit.height}" fill="none" stroke="${colors.grid}" stroke-width="0.7"/>`,
  ];
  for (let column = 1; column < columns.length; column += 1) {
    parts.push(`<line x1="${geometry.starts[column]}" y1="${y}" x2="${geometry.starts[column]}" y2="${y + unit.height}" stroke="${colors.grid}" stroke-width="0.65"/>`);
  }
  unit.cells.forEach((lines, column) => {
    if (!lines.length) return;
    const centered = column === 0 || (!isSupplement && column > 1) || (isSupplement && column === 1);
    const x = centered
      ? geometry.starts[column] + columns[column].width / 2
      : geometry.starts[column] + (theme.id === 'classic' ? 5 : 6);
    parts.push(wrappedText(x, y + theme.rowPadding + theme.tableFont, lines, {
      size: theme.tableFont, fill: colors.ink,
      weight: column === 1 && !isSupplement ? 500 : 400,
      anchor: centered ? 'middle' : 'start',
      lineHeight: theme.tableLineHeight,
    }));
  });
  return parts.join('');
}

function drawFinalSignatory(theme, layout) {
  const top = 822;
  const boxX = 466;
  const boxY = 852;
  const boxWidth = PAGE_WIDTH - layout.margin - boxX;
  const boxHeight = 178;
  const isClassic = theme.id === 'classic';
  const colors = theme.colors;
  return [
    textElement(layout.margin, top, 'Certified that the particulars given above are true and correct.', {
      size: isClassic ? 8.8 : theme.metaFont, fill: colors.ink,
    }),
    (isClassic
      ? `<rect x="${boxX}" y="${boxY}" width="${boxWidth}" height="${boxHeight}" fill="#ffffff" stroke="${colors.grid}" stroke-width="0.9"/>`
      : `<rect x="${boxX}" y="${boxY}" width="${boxWidth}" height="${boxHeight}" rx="${theme.metadataPanelRadius}" fill="${colors.card}" stroke="${colors.grid}" stroke-width="0.9"/>`),
    textElement(boxX + boxWidth / 2, boxY + 27, `For ${COMPANY.name}`, {
      size: isClassic ? 7.2 : theme.metaFont - 1, fill: colors.ink, weight: 700, anchor: 'middle', letterSpacing: 0.6,
    }),
    textElement(boxX + boxWidth / 2, boxY + 47, 'UNSIGNED · SIGNATURE PLACEHOLDER', {
      size: isClassic ? 6.4 : theme.metaFont - 2, fill: colors.muted, weight: 600, anchor: 'middle', letterSpacing: 0.35,
    }),
    `<line x1="${boxX + 18}" y1="${boxY + 132}" x2="${boxX + boxWidth - 18}" y2="${boxY + 132}" stroke="${colors.grid}" stroke-width="0.8"/>`,
    textElement(boxX + boxWidth / 2, boxY + 157, 'Authorised Signatory', {
      size: isClassic ? 8 : theme.metaFont, fill: colors.ink, weight: 700, anchor: 'middle', letterSpacing: 0.5,
    }),
  ].join('');
}

function drawFooter(pageIndex, pageCount, finalPage, theme, layout) {
  const isClassic = theme.id === 'classic';
  const colors = theme.colors;
  const margin = layout.margin;
  const parts = [
    `<line x1="${margin}" y1="1077" x2="${PAGE_WIDTH - margin}" y2="1077" stroke="${colors.grid}" stroke-width="0.8"/>`,
    textElement(margin, 1092, 'Saved receipt details only · No inventory quantities are posted', {
      size: isClassic ? 7.7 : theme.metaFont - 1, fill: colors.muted,
    }),
    textElement(PAGE_WIDTH - margin, 1092, `Page ${pageIndex + 1} of ${pageCount}`, {
      size: isClassic ? 7.7 : theme.metaFont - 1, fill: colors.muted, anchor: 'end',
    }),
  ];
  if (finalPage) parts.unshift(drawFinalSignatory(theme, layout));
  return parts.join('');
}

function renderPage(model, page, pageIndex, pageCount, hasLegacyBalance, theme, layout) {
  const isClassic = theme.id === 'classic';
  const colors = theme.colors;
  const margin = layout.margin;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" viewBox="0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}" role="img" aria-label="Purchase Received ${escapeXml(model.number)}, page ${pageIndex + 1} of ${pageCount}">`,
    drawPageHeader(model, pageIndex, pageCount, theme, layout),
  ];
  let y = layout.bodyStartY;
  let previousType = '';
  let sectionRows = 0;
  for (const unit of page.units) {
    if (unit.type !== previousType) {
      if (unit.type === 'metadata') {
        parts.push(
          textElement(margin + (isClassic ? 10 : theme.metadataPanelPad), y + (isClassic ? 12 : 14), 'SUPPLIER', {
            size: isClassic ? 7.3 : theme.metaFont - 1.5,
            fill: colors.muted, weight: 700, letterSpacing: 0.55,
          }),
          textElement(margin + layout.metadataLeftWidth + layout.metadataGap, y + (isClassic ? 12 : 14), 'RECEIPT & ORDER DETAILS', {
            size: isClassic ? 7.3 : theme.metaFont - 1.5,
            fill: colors.muted, weight: 700, letterSpacing: 0.55,
          }),
        );
        y += sectionHeaderHeight('metadata', hasLegacyBalance, theme);
      } else if (unit.type === 'main') {
        parts.push(drawMainHeading(y, theme, layout));
        y += sectionHeaderHeight('main', hasLegacyBalance, theme);
        sectionRows = 0;
      } else if (unit.type === 'source') {
        parts.push(
          textElement(margin + (isClassic ? 10 : theme.metadataPanelPad), y + (isClassic ? 12 : 14), 'ORDER & RECEIVER', {
            size: isClassic ? 7.3 : theme.metaFont - 1.5,
            fill: colors.muted, weight: 700, letterSpacing: 0.55,
          }),
          textElement(margin + layout.metadataLeftWidth + layout.metadataGap, y + (isClassic ? 12 : 14), 'DESTINATION & VENDOR', {
            size: isClassic ? 7.3 : theme.metaFont - 1.5,
            fill: colors.muted, weight: 700, letterSpacing: 0.55,
          }),
        );
        y += sectionHeaderHeight('source', hasLegacyBalance, theme);
        sectionRows = 0;
      } else {
        parts.push(drawSupplementHeading(y, hasLegacyBalance, theme, layout));
        y += sectionHeaderHeight('supplement', hasLegacyBalance, theme);
        sectionRows = 0;
      }
      previousType = unit.type;
    }
    if (unit.type === 'metadata') parts.push(drawMetadataUnit(unit, y, theme, layout));
    else if (unit.type === 'source') parts.push(drawSourceUnit(unit, y, theme, layout));
    else parts.push(drawRows(unit, y, sectionRows++, theme, layout));
    y += unit.height;
  }
  parts.push(drawFooter(pageIndex, pageCount, pageIndex === pageCount - 1, theme, layout), '</svg>');
  return parts.join('');
}

/**
 * Render a saved Purchase Received model into reference-style Classic A4 SVG pages.
 * No prices, tax figures, product-master lookups, or unsaved values are introduced.
 */
export function renderPRReceiptPages(model, templateId = 'classic') {
  if (!Object.hasOwn(THEMES, templateId)) {
    throw new Error(`Unsupported Purchase Received template: ${String(templateId)}`);
  }
  const normalized = normalizeModel(model);
  const layout = prepareLayout(normalized, THEMES[templateId]);
  const legacyBalance = normalized.lines.some((line) => line.balanceAfterQty === null);
  const units = [
    ...makeMetadataUnits(normalized, layout, layout),
    ...makeMainUnits(normalized, layout.mainGeometry, layout),
    ...makeSourceUnits(normalized, layout, layout),
    ...makeSupplementUnits(normalized, layout.supplementGeometry, layout),
  ];
  const pages = packUnits(units, legacyBalance, layout);
  return pages.map((page, index) =>
    renderPage(normalized, page, index, pages.length, legacyBalance, layout, layout));
}