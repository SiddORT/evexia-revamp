import { expect } from '@playwright/test';

// Verify portalled exports have their own palette and shared item styles.
export async function checkExportMenuStyles(page, triggerId, expectedWidth) {
  for (const theme of ['classic', 'modern']) {
    for (const appearance of ['light', 'dark']) {
      await page.evaluate(async ({ theme, appearance }) => {
        const prefs = await import('/src/components/admin/adminPreferences.js');
        prefs.setAdminPreference('theme', theme);
        prefs.setAdminPreference('appearance', appearance);
      }, { theme, appearance });
      const trigger = page.getByTestId(triggerId);
      await trigger.focus();
      await page.keyboard.press('ArrowDown');
      const menu = page.getByRole('menu');
      await expect(menu).toHaveAttribute('data-admin-theme', theme);
      await expect(menu).toHaveAttribute('data-admin-appearance', appearance);
      await expect(menu).toHaveClass(/admin-dropdown__menu/);
      expect((await menu.boundingBox()).width).toBeCloseTo(expectedWidth, 0);
      expect(await menu.evaluate((node) => {
        const style = getComputedStyle(node);
        const normalize = (value) => {
          const probe = document.createElement('span');
          probe.style.color = value;
          node.append(probe);
          const color = getComputedStyle(probe).color;
          probe.remove();
          return color;
        };
        return style.backgroundColor === normalize(style.getPropertyValue('--admin-surface')) &&
          style.borderTopColor === normalize(style.getPropertyValue('--admin-border')) &&
          style.padding === '7px' && style.zIndex === '60';
      })).toBe(true);
      for (const label of ['CSV', 'Excel (.xlsx)']) {
        const item = menu.getByRole('menuitem', { name: label, exact: true });
        await expect(item).toHaveClass('admin-dropdown__item');
        await expect(item).toBeFocused();
        await expect(item).toHaveAttribute('data-highlighted', '');
        expect(await item.evaluate((node) => {
          const style = getComputedStyle(node);
          const probe = document.createElement('span');
          probe.style.color = 'var(--admin-state-hover)';
          node.append(probe);
          const hover = getComputedStyle(probe).color;
          probe.style.color = 'var(--admin-text)';
          const text = getComputedStyle(probe).color;
          probe.remove();
          return style.backgroundColor === hover && style.color === text &&
            style.display === 'flex' && style.padding === '10px 11px';
        })).toBe(true);
        await page.keyboard.press('ArrowDown');
      }
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
  }
}
