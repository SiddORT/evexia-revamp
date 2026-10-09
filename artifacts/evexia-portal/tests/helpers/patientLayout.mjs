import { expect } from '@playwright/test';

// The portal uses pixel font sizes. Root font-size or deviceScaleFactor alone
// would not test enlarged text. Snapshot ALL baselines before doubling them,
// including hidden tab panels; rerun after dynamic diagnostics appear.
export async function enlargePatientText(page, selector) {
  await page.locator(selector).evaluate((root, selector) => {
    document.getElementById('patient-text-enlargement')?.remove();
    const sizes = new Map();
    for (const node of [root, ...root.querySelectorAll('*')]) {
      if (node.closest('svg')) continue;
      const path = [];
      for (let ancestor = node; ancestor !== root; ancestor = ancestor.parentElement) {
        path.unshift(ancestor.tagName.toLowerCase() + [...ancestor.classList].map((name) => `.${CSS.escape(name)}`).join(''));
      }
      sizes.set(selector + (path.length ? ` > ${path.join(' > ')}` : ''), parseFloat(getComputedStyle(node).fontSize));
    }
    const style = document.createElement('style');
    style.id = 'patient-text-enlargement';
    style.textContent = [...sizes].map(([key, size]) => `${key} { font-size: ${size * 2}px !important; }`).join('\n');
    document.head.append(style);
  }, selector);
}

export async function expectPatientFits(page, selector) {
  const failures = await page.locator(selector).evaluate((root) => {
    const failures = [];
    if (document.documentElement.scrollWidth > innerWidth + 1) failures.push('page horizontal overflow');
    for (const node of [root, ...root.querySelectorAll('*')]) {
      // Native popup option geometry is not exposed by the engines. Verify
      // the selected label using text metrics below, not imaginary popup boxes.
      if (!node.getClientRects().length || node.closest('svg') || node.matches('option, input')) continue;
      const rect = node.getBoundingClientRect(), css = getComputedStyle(node);
      if (!rect.width || !rect.height) continue;
      const label = `${node.tagName}.${node.className}: ${node.textContent.trim().slice(0, 70)}`;
      if (rect.left < -1 || rect.right > innerWidth + 1) failures.push(`outside viewport: ${label}`);
      // Native select scrollWidth can include its OS-owned popup/options.
      // Check the control bounds and selected-label/description instead.
      if (!node.matches('select') && node.clientWidth && node.scrollWidth > node.clientWidth + 1) failures.push(`horizontal clipping ${node.scrollWidth} > ${node.clientWidth} (rect ${rect.left}, ${rect.right}): ${label}`);
       if (!node.matches('select, .patient-doctor__menu') && node.clientHeight && node.scrollHeight > node.clientHeight + 1) failures.push(`vertical clipping ${node.scrollHeight} > ${node.clientHeight}: ${label}`);
      if (node.matches('select')) {
        const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
        context.font = `${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
        const selectedText = node.selectedOptions[0]?.text || '';
        const width = context.measureText(selectedText).width;
        // Native selects cannot wrap arbitrary long Doctor/PIN labels. Require
        // their FULL selection in a visible associated description when the
        // control itself truncates; that description is geometry-checked too.
        const fullDescription = (node.getAttribute('aria-describedby') || '').split(/\s+/)
          .map((id) => document.getElementById(id)).some((description) =>
            description?.getClientRects().length && description.textContent.includes(selectedText));
        if (width + parseFloat(css.paddingLeft) + parseFloat(css.paddingRight) + 20 > rect.width && !fullDescription) failures.push(`selected label clipped without readable description (${width}px in ${rect.width}px): ${label}`);
        if (parseFloat(css.fontSize) * 1.2 + parseFloat(css.paddingTop) + parseFloat(css.paddingBottom) > rect.height + 1) failures.push(`control text height: ${label}`);
        continue;
      }
      for (const child of node.childNodes) {
        if (child.nodeType !== Node.TEXT_NODE || !child.textContent.trim()) continue;
        const range = document.createRange(); range.selectNodeContents(child);
        for (const line of range.getClientRects()) {
          if (line.left < rect.left - 1 || line.right > rect.right + 1 ||
              line.top < rect.top - 1 || line.bottom > rect.bottom + 1) failures.push(`text outside box: ${label}`);
        }
      }
    }
    if (failures.length) {
      failures.push(...[...root.querySelectorAll('select, .mr-form__hint, .mr-form__actions')].filter((node) => node.getClientRects().length).map((node) => {
        const box = node.getBoundingClientRect(), css = getComputedStyle(node);
        return `diagnostic ${node.id || node.className}: client=${node.clientWidth}x${node.clientHeight} scroll=${node.scrollWidth}x${node.scrollHeight} rect=${box.left},${box.top},${box.right},${box.bottom} overflow=${css.overflowX} wrap=${css.overflowWrap} font=${css.fontSize}`;
      }));
    }
    return failures;
  });
  expect(failures, 'Patient text and controls must be readable without hidden clipping').toEqual([]);
}

export async function keyboardReach(page, start, target, max = 40) {
  await start.focus();
  for (let count = 0; count < max && !await target.evaluate((node) => node === document.activeElement); count++) {
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
  // Firefox completes keyboard scrolling asynchronously. Wait for the real
  // focus scroll to settle; do not scroll the target manually or widen bounds.
  await expect.poll(async () => target.evaluate((node) => {
    const visible = node.matches('input[type=file]') ? node.closest('label') : node;
    const rect = visible.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth + 1 && rect.top >= 0 && rect.bottom <= innerHeight + 1;
  }), { message: 'Tab must bring the complete Patient control into view' }).toBe(true);
}
