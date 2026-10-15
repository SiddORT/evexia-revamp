import { expect } from '@playwright/test';

export async function chooseLanguage(page, value) {
  const field = page.getByTestId('select-patient-instructionsLanguage');
  await field.fill(value);
  await page.getByRole('option', { name: value, exact: true }).click();
  await expect(field).toHaveValue(value);
}

export async function choosePhoneCountry(page, field, iso) {
  await field.fill(`(${iso})`);
  await page.getByRole('option', { name: new RegExp(`\\(${iso}\\)`) }).click();
  await expect(field).toHaveValue(new RegExp(`^${iso} \\+`));
}

export async function expectPhoneCountries(page, field, codes) {
  for (const iso of codes) {
    await field.fill(`(${iso})`);
    await expect(page.getByRole('option', { name: new RegExp(`\\(${iso}\\)`) })).toBeVisible();
    await field.press('Escape');
  }
}
