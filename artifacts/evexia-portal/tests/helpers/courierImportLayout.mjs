import { expect } from '@playwright/test';

// Resize text, not the viewport or the whole page. The portal uses px sizes,
// so changing only the root font size would not exercise text enlargement.
// Capture baselines before applying any rules to avoid doubling inheritance.
export async function enlargeCourierText(page) {
  return page.locator('.excel-import--courier').evaluate((root) => {
    const sizes = new Map();
    for (const node of [root, ...root.querySelectorAll('*')]) {
      if (node.closest('svg')) continue;
      const path = [];
      for (let ancestor = node; ancestor !== root; ancestor = ancestor.parentElement) {
        path.unshift(ancestor.tagName.toLowerCase() + [...ancestor.classList].map((name) => `.${CSS.escape(name)}`).join(''));
      }
      const selector = '.excel-import--courier' + (path.length ? ` > ${path.join(' > ')}` : '');
      sizes.set(selector, parseFloat(getComputedStyle(node).fontSize));
    }
    const style = document.createElement('style');
    style.textContent = [...sizes].map(([selector, size]) =>
      `${selector} { font-size: ${size * 2}px !important; }`).join('\n');
    document.head.append(style);
    return parseFloat(getComputedStyle(root.querySelector('h2')).fontSize);
  });
}

export async function expectCourierContentFits(page) {
  const failures = await page.locator('.excel-import--courier').evaluate((root) => {
    const failures = [];
    if (document.documentElement.scrollWidth > innerWidth + 1) failures.push('page horizontal overflow');
    for (const node of [root, ...root.querySelectorAll('*')]) {
      // Closed details content and the intentionally hidden native file input
      // are not visible text. Its label is checked as the visible picker.
      if (!node.getClientRects().length || node.closest('svg') || node.matches('input')) continue;
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const label = `${node.tagName}.${node.className}: ${node.textContent.slice(0, 70)}`;
      if (rect.left < -1 || rect.right > innerWidth + 1) failures.push(`outside viewport: ${label}`);
      if (node.clientWidth && node.scrollWidth > node.clientWidth + 1) failures.push(`horizontal clipping: ${label}`);
      if (node.clientHeight && node.scrollHeight > node.clientHeight + 1) failures.push(`vertical clipping: ${label}`);
      // Range geometry also catches overflowing inline text and clipping
      // masked by an ancestor's overflow:hidden.
      for (const child of node.childNodes) {
        if (child.nodeType !== Node.TEXT_NODE || !child.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(child);
        for (const line of range.getClientRects()) {
          for (let parent = node; parent && root.contains(parent); parent = parent.parentElement) {
            const box = parent.getBoundingClientRect();
            if (line.left < box.left - 1 || line.right > box.right + 1 ||
                line.top < box.top - 1 || line.bottom > box.bottom + 1) {
              failures.push(`text outside ${parent.tagName}.${parent.className}: ${child.textContent.slice(0, 70)}`);
              break;
            }
          }
        }
      }
    }
    return failures;
  });
  expect(failures, 'enlarged Courier content must wrap without hidden clipping').toEqual([]);
}

export async function tabToCourierControl(page, target) {
  // Establish a known position, then use real Tab navigation to the control.
  await page.locator('.excel-import__back').focus();
  for (let count = 0; count < 30; count++) {
    if (await target.evaluate((node) => node === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
  const focus = await target.evaluate((node) => {
    const visible = node.matches('input') ? node.closest('label') : node;
    const style = getComputedStyle(visible);
    const box = visible.getBoundingClientRect();
    const inset = parseFloat(style.outlineWidth) + Math.max(0, parseFloat(style.outlineOffset));
    return {
      keyboard: node.matches(':focus-visible'),
      outline: style.outlineStyle,
      width: parseFloat(style.outlineWidth),
      color: style.outlineColor,
      withinViewport: box.left - inset >= 0 && box.right + inset <= innerWidth &&
        box.top - inset >= 0 && box.bottom + inset <= innerHeight,
      clipped: [...function* () { for (let p = visible.parentElement; p; p = p.parentElement) yield p; }()]
        .some((parent) => {
          const css = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
          return (/(hidden|clip|auto|scroll)/.test(css.overflowX) &&
              (box.left - inset < bounds.left || box.right + inset > bounds.right)) ||
            (/(hidden|clip|auto|scroll)/.test(css.overflowY) &&
              (box.top - inset < bounds.top || box.bottom + inset > bounds.bottom));
        }),
    };
  });
  expect(focus.keyboard).toBe(true);
  expect(focus.outline).not.toBe('none');
  expect(focus.width).toBeGreaterThanOrEqual(2);
  expect(focus.color).not.toBe('rgba(0, 0, 0, 0)');
  expect(focus.withinViewport, 'Tab must scroll the whole control and focus ring into view').toBe(true);
  expect(focus.clipped, 'ancestors must not clip the keyboard focus ring').toBe(false);
}
