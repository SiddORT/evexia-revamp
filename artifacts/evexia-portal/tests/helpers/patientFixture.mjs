import { authenticateAdmin } from './authenticateAdmin.mjs';
import { expect } from '@playwright/test';

// Only run through run-authenticated-previews.sh: this provisions synthetic
// relationships in its private database, never the managed development data.
export async function seedPatientRelationships(page) {
  await authenticateAdmin(page);
  await page.goto(process.env.EVEXIA_PREVIEW_BASE_URL + '/admin/masters/patients');
  await expect(page.getByTestId('button-add-patient')).toBeVisible();
  const tag = crypto.randomUUID().slice(0, 8);
  return page.evaluate(async (tag) => {
    const auth = await import('/src/auth/adminSession.js');
    const hq = await auth.headquarterRequest('', { body: { name: `Patient HQ ${tag}`, status: 'active' } });
    const zone = await auth.zoneRequest('', { body: { name: `Patient Zone ${tag}`, status: 'active' } });
    const mr = (await auth.mrRequest('', { body: {
      name: `Patient MR ${tag}`, userId: `patient.mr.${tag}`, employeeCode: `PAT-${tag}`, contactRequirement: 'optional',
      dateOfJoining: '2020-01-01', designation: 'Synthetic', phone: '', email: '', hq: hq.id, zoneId: zone.id,
      addressLine1: 'Synthetic street', addressLine2: '', landmark: 'Landmark', pincode: '110001', city: 'Delhi',
      state: 'Delhi', country: 'India', status: 'active', paymentLimit: '0.00', doctorDaysLimit: 0,
    } })).record;
    const doctor = await auth.doctorRequest('', { body: {
      name: `Patient Doctor ${tag}`, registrationNumber: `PATREG-${tag}`, qualification: 'MBBS', phone: '', alternatePhone: '',
      email: '', contactRequirement: 'optional', dialCountry: 'IN', dateOfJoining: null, clinicName: 'Synthetic clinic',
      mrId: mr.id, status: 'active', invoiceType: 'normal', gstNumber: '', drugLicenceNumber: '', orderDiscount: '0.00',
      daysLimit: 0, paymentLimit: '0.00', pincode: '110001', addressLine1: 'Synthetic street', addressLine2: '',
      landmark: 'Landmark', country: 'India', state: 'Delhi', city: 'Delhi',
    } });
    return { tag, mr, zone, doctor };
  }, tag);
}
