import { expect } from '@playwright/test';

const roots = '.rp, .rp-tabs, .rp-scope';

// Snapshot every computed size before applying any rules. Root zoom would miss
// the pixel-sized controls; repeated inherited 200% rules would compound sizes.
export async function enlargeRoleText(page) {
  await page.evaluate((roots) => {
    document.getElementById('roles-text-enlargement')?.remove();
    const nodes = [...document.querySelectorAll(roots)]
      .flatMap((root) => [root, ...root.querySelectorAll('*')])
      .filter((node) => !node.closest('svg'));
    const sizes = nodes.map((node, index) => {
      node.dataset.roleTextSize = String(index);
      return parseFloat(getComputedStyle(node).fontSize);
    });
    const style = document.createElement('style');
    style.id = 'roles-text-enlargement';
    style.textContent = sizes.map((size, index) =>
      `[data-role-text-size="${index}"] { font-size: ${size * 2}px !important; }`).join('\n');
    document.head.append(style);
  }, roots);
}

export async function expectRoleLayoutFits(page) {
  const failures = await page.evaluate((roots) => {
    const failures = [];
    if (document.documentElement.scrollWidth > innerWidth + 1) failures.push('page horizontal overflow');
    for (const root of document.querySelectorAll(roots)) {
      for (const node of [root, ...root.querySelectorAll('*')]) {
        if (!node.getClientRects().length || node.closest('svg') || node.matches('.sr-only')) continue;
        const rect = node.getBoundingClientRect(), css = getComputedStyle(node);
        if (!rect.width || !rect.height) continue;
        const label = node.dataset.testid || `${node.tagName}.${node.className}`;
        if (rect.left < -1 || rect.right > innerWidth + 1) failures.push(`outside viewport: ${label}`);
        if (node.matches('input, progress')) continue; // native internal geometry is engine-owned
        if (node.clientWidth && node.scrollWidth > node.clientWidth + 1) failures.push(`horizontal clipping: ${label} (${node.scrollWidth} > ${node.clientWidth}); children: ${[...node.children].map((child) => {
          const box = child.getBoundingClientRect();
          return `${child.tagName}.${child.className} width=${box.width} scroll=${child.scrollWidth} client=${child.clientWidth}`;
        }).join('; ')}`);
        // Scrollable directories/rails may legitimately be taller than their
        // viewport, but hidden overflow must not conceal text or controls.
        if (!['auto', 'scroll'].includes(css.overflowY) && node.clientHeight &&
            node.scrollHeight > node.clientHeight + 1) failures.push(`vertical clipping: ${label}`);
        for (const child of node.childNodes) {
          if (child.nodeType !== Node.TEXT_NODE || !child.textContent.trim()) continue;
          const range = document.createRange(); range.selectNodeContents(child);
          for (const line of range.getClientRects()) {
            if (line.left < rect.left - 1 || line.right > rect.right + 1 ||
                 line.top < rect.top - 1 || line.bottom > rect.bottom + 1) failures.push(`text outside box: ${label} (${child.textContent.trim()}; line ${line.left},${line.top},${line.right},${line.bottom}; box ${rect.left},${rect.top},${rect.right},${rect.bottom})`);
          }
        }
      }
    }
    return failures;
  }, roots);
  expect(failures, 'Roles and Permissions text must fit, not merely avoid page overflow').toEqual([]);
}

export async function expectCompactPermissionRows(page) {
  const rows = await page.locator('.rp-matrix__grid').evaluateAll((grids) => grids.map((grid) => {
    const controls = [...grid.querySelectorAll('.rp-action')];
    const boxes = controls.map((node) => node.getBoundingClientRect());
    return {
      count: controls.length,
      oneRow: boxes.every((box) => Math.abs(box.top - boxes[0].top) < 1),
      readable: controls.every((node) => {
        const label = node.querySelector('strong'), box = label.getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(label);
        const lines = [...range.getClientRects()];
        return parseFloat(getComputedStyle(label).fontSize) >= 13 &&
          lines.length === 1 && lines.every((line) => line.width <= box.width + 1);
      }),
      targets: controls.every((node) => {
        const label = node.querySelector('label').getBoundingClientRect();
        const help = node.querySelector('button').getBoundingClientRect();
        return label.width >= 44 && label.height >= 40 && help.width >= 28 &&
          help.height >= 40 && label.right <= help.left + 1;
      }),
    };
  }));
  expect(rows).toEqual(Array.from({ length: 8 }, () => ({ count: 5, oneRow: true, readable: true, targets: true })));
  await expectRoleLayoutFits(page);
}

export async function expectRoleFocusVisible(locator) {
  await expect(locator).toBeFocused();
  // Keyboard scrolling can finish asynchronously in Firefox.
  await expect.poll(() => locator.evaluate((node) => {
    const rect = node.getBoundingClientRect(), css = getComputedStyle(node);
    return {
      visible: node.matches(':focus-visible'),
      outlined: css.outlineStyle !== 'none' && parseFloat(css.outlineWidth) > 0,
      inViewport: rect.left >= 0 && rect.right <= innerWidth + 1 &&
        rect.top >= 0 && rect.bottom <= innerHeight + 1,
      ...(!(rect.left >= 0 && rect.right <= innerWidth + 1 && rect.top >= 0 && rect.bottom <= innerHeight + 1)
        ? { bounds: `${rect.left},${rect.top},${rect.right},${rect.bottom} in ${innerWidth}x${innerHeight}` } : {}),
    };
  }), { message: 'Keyboard focus indicator and complete control must be visible' })
    .toEqual({ visible: true, outlined: true, inViewport: true });
}

export async function reachRoleControlByKeyboard(page, start, target) {
  await start.focus();
  for (let count = 0; count < 12 && !await target.evaluate((node) => node === document.activeElement); count++) {
    await page.keyboard.press('Tab');
  }
  await expectRoleFocusVisible(target);
}
