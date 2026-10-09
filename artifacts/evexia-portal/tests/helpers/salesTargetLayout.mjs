import { expect } from '@playwright/test';

// Snapshot pixel-based baselines before doubling, including dynamic options and
// reports. Reapply after new content appears; never compound earlier doubling.
export async function enlargeTargetText(page) {
  await page.evaluate(() => {
    document.getElementById('sales-target-text-enlargement')?.remove();
    const rules = new Map();
    for (const root of document.querySelectorAll('.admin-target-page, .admin-target-dialog, .admin-target-summary-dialog, .excel-import--sales-target, .sales-target-export-menu')) {
      const selector = '.' + [...root.classList].join('.');
      for (const node of [root, ...root.querySelectorAll('*')]) {
        if (node.closest('svg')) continue;
        const path = [];
        for (let ancestor = node; ancestor !== root; ancestor = ancestor.parentElement) {
          path.unshift(ancestor.tagName.toLowerCase() + [...ancestor.classList].map((name) => `.${CSS.escape(name)}`).join(''));
        }
        rules.set(selector + (path.length ? ` > ${path.join(' > ')}` : ''), parseFloat(getComputedStyle(node).fontSize) * 2);
      }
    }
    const style = document.createElement('style');
    style.id = 'sales-target-text-enlargement';
    style.textContent = [...rules].map(([selector, size]) => `${selector}{font-size:${size}px!important}`).join('\n');
    document.head.append(style);
  });
}

export async function expectTargetFits(page, selector) {
  const failures = await page.locator(selector).evaluate((root) => {
    const failures = [];
    if (document.documentElement.scrollWidth > innerWidth + 1) failures.push('page horizontal overflow');
    for (const node of [root, ...root.querySelectorAll('*')]) {
      if (!node.getClientRects().length || node.closest('svg, .sr-only') || node.matches('option, input[type=file]')) continue;
      const box = node.getBoundingClientRect(), css = getComputedStyle(node);
      if (!box.width || !box.height) continue;
      const label = `${node.tagName}.${node.className}: ${(node.value || node.textContent).trim().slice(0, 85)}`;
      // Desktop tables intentionally scroll horizontally. Their text still
      // must fit its own cell; this is not permission for other page overflow.
      const table = node.closest('.admin-table-scroll') && !node.matches('.admin-table-scroll');
      if (!table && (box.left < -1 || box.right > innerWidth + 1)) failures.push(`outside viewport: ${label}`);
      if (!node.matches('input, select') && node.clientWidth && node.scrollWidth > node.clientWidth + 1 && !['auto', 'scroll'].includes(css.overflowX)) failures.push(`horizontal clipping: ${label}`);
      if (!node.matches('input, select') && node.clientHeight && node.scrollHeight > node.clientHeight + 1 && !['auto', 'scroll'].includes(css.overflowY)) failures.push(`vertical clipping: ${label}`);
      if (node.matches('input, select')) {
        const ctx = document.createElement('canvas').getContext('2d');
        ctx.font = `${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
        const text = node.matches('select') ? node.selectedOptions[0]?.text || '' : node.value;
        const description = (node.getAttribute('aria-describedby') || '').split(/\s+/).map((id) => document.getElementById(id))
          .some((element) => element?.getClientRects().length && element.textContent.includes(text));
        if (ctx.measureText(text).width + parseFloat(css.paddingLeft) + parseFloat(css.paddingRight) + (node.matches('select') ? 20 : 0) > node.clientWidth + 1 && !description) failures.push(`control value clipped without readable description: ${label}`);
        if (parseFloat(css.fontSize) * 1.2 + parseFloat(css.paddingTop) + parseFloat(css.paddingBottom) > box.height + 1) failures.push(`control text height: ${label}`);
        continue;
      }
      for (const child of node.childNodes) {
        if (child.nodeType !== Node.TEXT_NODE || !child.textContent.trim()) continue;
        const range = document.createRange(); range.selectNodeContents(child);
        for (const line of range.getClientRects()) {
          if (line.left < box.left - 1 || line.right > box.right + 1 || line.top < box.top - 1 || line.bottom > box.bottom + 1) failures.push(`text outside box: ${label}`);
        }
      }
    }
    return failures;
  });
  expect(failures, 'Sales Target text and controls must fit their rendered boxes').toEqual([]);
}

export async function targetKeyboardReach(page, start, target) {
  await start.focus();
  for (let n = 0; n < 60 && !await target.evaluate((node) => node === document.activeElement); n++) await page.keyboard.press('Tab');
  await expect(target).toBeFocused();
  await expect.poll(() => target.evaluate((node) => {
    const box = node.getBoundingClientRect();
    return box.left >= -1 && box.right <= innerWidth + 1 && box.top >= -1 && box.bottom <= innerHeight + 1;
  }), { message: 'Keyboard focus must scroll the whole control into view' }).toBe(true);
}
