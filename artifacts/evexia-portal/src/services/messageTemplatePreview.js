export const SUPPORTED_TOKENS = Object.freeze([
  'recipient_name',
  'order_number',
  'amount',
  'company_name',
]);

export const SAMPLE_VALUES = Object.freeze({
  recipient_name: 'Aarav Mehta',
  order_number: 'EVX-SAMPLE-1042',
  amount: '₹1,250.00',
  company_name: 'EVEXIA LIFE SCIENCES (Demo)',
});

const SUPPORTED_TOKEN_SET = new Set(SUPPORTED_TOKENS);
const MAX_HTML_FILE_BYTES = 100_000;

/**
 * Finds token-like brace expressions without interpreting any template code.
 * A token must be exactly {{identifier}}; every other brace expression is
 * reported as malformed so callers can keep it visible and explain it.
 */
export function inspectTokens(text) {
  const source = typeof text === 'string' ? text : '';
  const tokens = [];
  const unknown = [];
  const malformed = [];
  const seenTokens = new Set();
  const seenUnknown = new Set();
  const seenMalformed = new Set();

  const addMalformed = (value) => {
    if (value && !seenMalformed.has(value)) {
      seenMalformed.add(value);
      malformed.push(value);
    }
  };

  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (character !== '{' && character !== '}') {
      index += 1;
      continue;
    }

    if (character === '}') {
      let end = index + 1;
      while (source[end] === '}') end += 1;
      addMalformed(source.slice(index, end));
      index = end;
      continue;
    }

    let openEnd = index + 1;
    while (source[openEnd] === '{') openEnd += 1;
    const openCount = openEnd - index;
    let closeStart = openEnd;
    while (closeStart < source.length && source[closeStart] !== '}' && source[closeStart] !== '{') {
      closeStart += 1;
    }

    if (source[closeStart] === '{') {
      if (openCount === 1) {
        addMalformed(source.slice(index, openEnd));
        index = openEnd;
        continue;
      }
      // Consume a nested brace expression as one malformed expression.
      let nestedEnd = closeStart;
      while (source[nestedEnd] === '{') nestedEnd += 1;
      while (nestedEnd < source.length && source[nestedEnd] !== '}') nestedEnd += 1;
      while (source[nestedEnd] === '}') nestedEnd += 1;
      const malformedText = source.slice(index, nestedEnd || openEnd);
      addMalformed(malformedText);
      index = Math.max(nestedEnd, openEnd);
      continue;
    }

    if (source[closeStart] !== '}') {
      const malformedExpression = openCount === 1 ? source.slice(index, openEnd) : source.slice(index);
      addMalformed(malformedExpression);
      index = openCount === 1 ? openEnd : source.length;
      continue;
    }

    let closeEnd = closeStart + 1;
    while (source[closeEnd] === '}') closeEnd += 1;
    const closeCount = closeEnd - closeStart;
    const name = source.slice(openEnd, closeStart);
    const expression = source.slice(index, closeEnd);
    if (openCount === 2 && closeCount === 2 && /^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
      if (!seenTokens.has(name)) {
        seenTokens.add(name);
        tokens.push(name);
      }
      if (!SUPPORTED_TOKEN_SET.has(name) && !seenUnknown.has(name)) {
        seenUnknown.add(name);
        unknown.push(name);
      }
    } else {
      addMalformed(expression);
    }
    index = closeEnd;
  }

  return { tokens, unknown, malformed };
}

function escapeHtmlValue(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Replaces only known literal tokens backed by an own string property.
 * This is a single pass over the original text; replacement values are never
 * interpreted as tokens or expressions.
 */
export function substituteTokens(text, values, html = false) {
  if (typeof text !== 'string') return '';
  const valueMap = values && (typeof values === 'object' || typeof values === 'function')
    ? values
    : Object.create(null);

  return text.replace(/(?<!\{)\{\{([A-Za-z][A-Za-z0-9_]*)\}\}(?!\})/g, (original, token) => {
    if (!SUPPORTED_TOKEN_SET.has(token) ||
      !Object.prototype.hasOwnProperty.call(valueMap, token) ||
      typeof valueMap[token] !== 'string') {
      return original;
    }
    return html ? escapeHtmlValue(valueMap[token]) : valueMap[token];
  });
}

const ALLOWED_TAGS = new Set([
  'p', 'div', 'span', 'br', 'hr',
  'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'ins',
  'sub', 'sup', 'small', 'big', 'font',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'pre', 'code',
  'ul', 'ol', 'li',
  'table', 'caption', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
]);

const VOID_TAGS = new Set(['br', 'hr', 'col']);
const CONTENT_BLOCKED_TAGS = new Set([
  'script', 'style', 'svg', 'math', 'iframe', 'frame', 'frameset',
  'object', 'embed', 'applet', 'template', 'noscript', 'noembed',
  'xmp', 'plaintext', 'textarea', 'title',
]);
const ALLOWED_ATTRIBUTES = new Set([
  'align', 'valign', 'bgcolor', 'color', 'face', 'size',
  'width', 'height', 'colspan', 'rowspan', 'border',
  'cellpadding', 'cellspacing', 'dir', 'lang', 'title', 'class', 'style',
]);
const COLOR_PATTERN = /^(?:#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|[a-z]{1,24}|rgba?\(\s*[\d.%\s,]+\)|hsla?\(\s*[\d.%\s,]+\))$/i;
const SAFE_CSS_COLORS = new Set([
  'aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige', 'bisque',
  'black', 'blanchedalmond', 'blue', 'blueviolet', 'brown', 'burlywood', 'cadetblue',
  'chartreuse', 'chocolate', 'coral', 'cornflowerblue', 'cornsilk', 'crimson', 'cyan',
  'darkblue', 'darkcyan', 'darkgoldenrod', 'darkgray', 'darkgreen', 'darkgrey',
  'darkkhaki', 'darkmagenta', 'darkolivegreen', 'darkorange', 'darkorchid', 'darkred',
  'darksalmon', 'darkseagreen', 'darkslateblue', 'darkslategray', 'darkslategrey',
  'darkturquoise', 'darkviolet', 'deeppink', 'deepskyblue', 'dimgray', 'dimgrey',
  'dodgerblue', 'firebrick', 'floralwhite', 'forestgreen', 'fuchsia', 'gainsboro',
  'ghostwhite', 'gold', 'goldenrod', 'gray', 'green', 'greenyellow', 'grey', 'honeydew',
  'hotpink', 'indianred', 'indigo', 'ivory', 'khaki', 'lavender', 'lavenderblush',
  'lawngreen', 'lemonchiffon', 'lightblue', 'lightcoral', 'lightcyan', 'lightgoldenrodyellow',
  'lightgray', 'lightgreen', 'lightgrey', 'lightpink', 'lightsalmon', 'lightseagreen',
  'lightskyblue', 'lightslategray', 'lightslategrey', 'lightsteelblue', 'lightyellow',
  'lime', 'limegreen', 'linen', 'magenta', 'maroon', 'mediumaquamarine', 'mediumblue',
  'mediumorchid', 'mediumpurple', 'mediumseagreen', 'mediumslateblue', 'mediumspringgreen',
  'mediumturquoise', 'mediumvioletred', 'midnightblue', 'mintcream', 'mistyrose', 'moccasin',
  'navajowhite', 'navy', 'oldlace', 'olive', 'olivedrab', 'orange', 'orangered', 'orchid',
  'palegoldenrod', 'palegreen', 'paleturquoise', 'palevioletred', 'papayawhip', 'peachpuff',
  'peru', 'pink', 'plum', 'powderblue', 'purple', 'rebeccapurple', 'red', 'rosybrown',
  'royalblue', 'saddlebrown', 'salmon', 'sandybrown', 'seagreen', 'seashell', 'sienna',
  'silver', 'skyblue', 'slateblue', 'slategray', 'slategrey', 'snow', 'springgreen',
  'steelblue', 'tan', 'teal', 'thistle', 'tomato', 'transparent', 'turquoise', 'violet',
  'wheat', 'white', 'whitesmoke', 'yellow', 'yellowgreen', 'currentcolor',
]);

function validColor(value) {
  const normalized = value.trim().toLowerCase();
  if (SAFE_CSS_COLORS.has(normalized)) return true;
  if (!COLOR_PATTERN.test(normalized)) return false;
  return normalized.startsWith('#') || /^(?:rgba?|hsla?)\(/.test(normalized);
}

function validLength(value, allowAuto = false) {
  const normalized = value.trim().toLowerCase();
  return (allowAuto && normalized === 'auto') ||
    normalized === '0' ||
    /^(?:\d{1,3})(?:\.\d{1,2})?(?:px|pt|em|rem|%)$/.test(normalized);
}

function sanitizeCssValue(property, rawValue) {
  const value = rawValue.trim().toLowerCase();
  if (!value || value.length > 120 || /[\\/@'"<>]/.test(value) || /url|expression|var\s*\(/i.test(value)) {
    return null;
  }

  if (property === 'color' || property === 'background-color' || property === 'border-color') {
    return validColor(value) ? value : null;
  }
  if (property === 'font-family') {
    return /^[a-z0-9 _,-]{1,100}$/.test(value) ? value : null;
  }
  if (property === 'font-size') {
    return /^(?:xx-small|x-small|small|medium|large|x-large|xx-large|smaller|larger)$/.test(value) ||
      validLength(value) ? value : null;
  }
  if (property === 'font-weight') {
    return /^(?:normal|bold|bolder|lighter|[1-9]00)$/.test(value) ? value : null;
  }
  if (property === 'font-style') {
    return /^(?:normal|italic|oblique)$/.test(value) ? value : null;
  }
  if (property === 'text-decoration') {
    return /^(?:none|underline|overline|line-through)$/.test(value) ? value : null;
  }
  if (property === 'text-align') {
    return /^(?:left|right|center|justify|start|end)$/.test(value) ? value : null;
  }
  if (property === 'vertical-align') {
    return /^(?:baseline|sub|super|top|text-top|middle|bottom|text-bottom)$/.test(value) ||
      validLength(value) ? value : null;
  }
  if (property === 'white-space') {
    return /^(?:normal|pre|pre-wrap|pre-line|nowrap)$/.test(value) ? value : null;
  }
  if (property === 'line-height') {
    return value === 'normal' || /^\d{1,2}(?:\.\d{1,2})?$/.test(value) || validLength(value)
      ? value : null;
  }
  if (property === 'letter-spacing') {
    return value === 'normal' || validLength(value);
  }
  if (property === 'border-style') {
    return /^(?:none|hidden|dotted|dashed|solid|double|groove|ridge|inset|outset)$/.test(value)
      ? value : null;
  }
  if (property === 'border-collapse') {
    return /^(?:collapse|separate)$/.test(value) ? value : null;
  }
  if (property === 'border-width') return validLength(value) ? value : null;
  if (property === 'border') {
    const parts = value.split(/\s+/);
    return parts.length <= 3 && parts.every((part) =>
      validLength(part) || /^(?:none|hidden|dotted|dashed|solid|double|groove|ridge|inset|outset)$/.test(part) ||
      validColor(part)) ? value : null;
  }
  if (/^(?:padding|padding-(?:top|right|bottom|left))$/.test(property)) {
    const parts = value.split(/\s+/);
    return parts.length <= 4 && parts.every((part) => validLength(part)) ? value : null;
  }
  if (/^(?:margin|margin-(?:top|right|bottom|left))$/.test(property)) {
    const parts = value.split(/\s+/);
    return parts.length <= 4 && parts.every((part) => validLength(part, true)) ? value : null;
  }
  if (/^(?:width|min-width|max-width|height|min-height|max-height)$/.test(property)) {
    return validLength(value, true) ? value : null;
  }
  if (property === 'display') {
    return /^(?:inline|inline-block|block|table|table-row|table-cell|none)$/.test(value)
      ? value : null;
  }
  return null;
}

const ALLOWED_STYLE_PROPERTIES = new Set([
  'color', 'background-color', 'font-family', 'font-size', 'font-weight', 'font-style',
  'text-decoration', 'text-align', 'vertical-align', 'white-space', 'line-height',
  'letter-spacing', 'border', 'border-color', 'border-style', 'border-width',
  'border-collapse', 'padding', 'padding-top', 'padding-right', 'padding-bottom',
  'padding-left', 'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'width', 'min-width', 'max-width', 'height', 'min-height', 'max-height', 'display',
]);

function sanitizeStyle(styleText) {
  const safeDeclarations = [];
  for (const declaration of styleText.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon < 1) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    if (!ALLOWED_STYLE_PROPERTIES.has(property)) continue;
    const value = sanitizeCssValue(property, declaration.slice(colon + 1));
    if (value) safeDeclarations.push(`${property}:${value}`);
  }
  return safeDeclarations.join(';');
}

function safeAttributeValue(name, value) {
  const normalized = value.trim();
  if (normalized.length > 300 || /[\u0000-\u001f\u007f]/.test(normalized)) return null;

  if (name === 'style') {
    const safeStyle = sanitizeStyle(normalized);
    return safeStyle || null;
  }
  if (name === 'align') return /^(?:left|right|center|justify)$/i.test(normalized) ? normalized : null;
  if (name === 'valign') return /^(?:top|middle|bottom|baseline)$/i.test(normalized) ? normalized : null;
  if (name === 'bgcolor' || name === 'color') return validColor(normalized) ? normalized : null;
  if (name === 'width' || name === 'height') {
    return /^(?:\d{1,4})(?:px|%)?$/i.test(normalized) ? normalized : null;
  }
  if (['colspan', 'rowspan', 'border', 'cellpadding', 'cellspacing', 'size'].includes(name)) {
    return /^\d{1,4}$/.test(normalized) ? normalized : null;
  }
  if (name === 'face') return /^[A-Za-z0-9 _,-]{1,100}$/.test(normalized) ? normalized : null;
  if (name === 'dir') return /^(?:ltr|rtl|auto)$/i.test(normalized) ? normalized : null;
  if (name === 'lang') return /^[A-Za-z0-9-]{1,35}$/.test(normalized) ? normalized : null;
  if (name === 'class') return /^[A-Za-z0-9 _-]{1,100}$/.test(normalized) ? normalized : null;
  if (name === 'title') return normalized;
  return null;
}

function escapeAttribute(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function escapeText(value) {
  return value
    .replace(/&(?!(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]+);)/gi, '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function findTagEnd(source, start) {
  let quote = '';
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index;
    }
  }
  return -1;
}

function parseTag(rawTag) {
  const match = /^<\s*(\/?)\s*([a-z][a-z0-9:-]*)/i.exec(rawTag);
  if (!match) return null;
  const closing = match[1] === '/';
  const name = match[2].toLowerCase();
  if (closing) return { closing, name, attributes: [] };

  const attributes = [];
  const rest = rawTag.slice(match[0].length, -1);
  const attributePattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let attributeMatch;
  while ((attributeMatch = attributePattern.exec(rest))) {
    const attrName = attributeMatch[1].toLowerCase();
    const value = attributeMatch[2] ?? attributeMatch[3] ?? attributeMatch[4] ?? '';
    attributes.push([attrName, value]);
  }
  return { closing, name, attributes };
}

function sanitizeAttributes(attributes) {
  const seen = new Set();
  const output = [];
  for (const [name, rawValue] of attributes) {
    if (!ALLOWED_ATTRIBUTES.has(name) || seen.has(name)) continue;
    seen.add(name);
    const value = safeAttributeValue(name, rawValue);
    if (value !== null) output.push(`${name}="${escapeAttribute(value)}"`);
  }
  return output.length ? ` ${output.join(' ')}` : '';
}

function findBlockedElementEnd(source, start, tagName) {
  const closePattern = new RegExp(`<\\/\\s*${tagName}\\s*>`, 'ig');
  closePattern.lastIndex = start;
  const match = closePattern.exec(source);
  // Unclosed raw/active content is discarded through the end of the source.
  return match ? closePattern.lastIndex : source.length;
}

/**
 * Conservatively tokenizes untrusted email HTML into a small formatting
 * allowlist. It never parses the source in a browser DOM, so parsing cannot
 * trigger remote image/font/style loads. Unknown harmless wrappers are
 * stripped while their text/children remain; executable/foreign/raw-text
 * elements are discarded with their contents.
 */
function sanitizeEmailHtml(source) {
  let output = '';
  let index = 0;
  while (index < source.length) {
    const tagStart = source.indexOf('<', index);
    if (tagStart === -1) {
      output += escapeText(source.slice(index));
      break;
    }
    if (tagStart > index) output += escapeText(source.slice(index, tagStart));

    if (source.startsWith('<!--', tagStart)) {
      const commentEnd = source.indexOf('-->', tagStart + 4);
      index = commentEnd === -1 ? source.length : commentEnd + 3;
      continue;
    }

    if (source.startsWith('<!', tagStart) || source.startsWith('<?', tagStart)) {
      const declarationEnd = findTagEnd(source, tagStart + 2);
      index = declarationEnd === -1 ? source.length : declarationEnd + 1;
      continue;
    }

    const tagEnd = findTagEnd(source, tagStart + 1);
    if (tagEnd === -1) {
      // No complete tag remains. Escape once instead of rescanning a long
      // malformed sequence of '<' characters quadratically on every keystroke.
      output += escapeText(source.slice(tagStart));
      break;
    }

    const tagText = source.slice(tagStart, tagEnd + 1);
    const tag = parseTag(tagText);
    if (!tag) {
      output += escapeText(tagText);
      index = tagEnd + 1;
      continue;
    }

    if (CONTENT_BLOCKED_TAGS.has(tag.name)) {
      index = tag.closing ? tagEnd + 1 : findBlockedElementEnd(source, tagEnd + 1, tag.name);
      continue;
    }

    if (ALLOWED_TAGS.has(tag.name)) {
      if (tag.closing) {
        if (!VOID_TAGS.has(tag.name)) output += `</${tag.name}>`;
      } else {
        output += `<${tag.name}${sanitizeAttributes(tag.attributes)}>`;
      }
    }
    index = tagEnd + 1;
  }
  return output;
}

const PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "object-src 'none'",
  "media-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src 'none'",
  "font-src 'none'",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  'sandbox',
].join('; ');

export function buildEmailPreview(html, values = null) {
  const source = typeof html === 'string' ? html : '';
  const substituted = values === null ? source : substituteTokens(source, values, true);
  const safeContent = sanitizeEmailHtml(substituted);
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}"><meta name="referrer" content="no-referrer"><style>html,body{margin:0;padding:0}body{padding:16px;color:#222;background:#fff;font:14px/1.5 Arial,sans-serif;overflow-wrap:anywhere}table{border-collapse:collapse;max-width:100%}td,th{vertical-align:top}</style></head><body>${safeContent}</body></html>`;
}

export async function readHtmlFile(file) {
  if (!file || typeof file !== 'object' || typeof file.name !== 'string' ||
    !/\.(?:html?|HTML?)$/i.test(file.name) || typeof file.arrayBuffer !== 'function') {
    throw new Error('Choose a valid .html or .htm file.');
  }
  if (Number.isFinite(file.size) && file.size > MAX_HTML_FILE_BYTES) {
    throw new Error('HTML files must be 100,000 bytes or smaller.');
  }

  let bytes;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    throw new Error('The HTML file could not be read. Choose it again and try again.');
  }
  if (bytes.byteLength > MAX_HTML_FILE_BYTES) {
    throw new Error('HTML files must be 100,000 bytes or smaller.');
  }
  if (bytes.byteLength === 0) throw new Error('The HTML file is empty.');

  let content;
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('The HTML file is not valid UTF-8.');
  }
  if (!content.trim()) throw new Error('The HTML file is empty.');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(content)) {
    throw new Error('The HTML file contains unsupported control characters. Your draft is unchanged.');
  }
  return content;
}