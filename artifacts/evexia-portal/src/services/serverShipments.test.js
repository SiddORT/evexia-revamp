import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mutationPath, shipmentExportRows, todayISO } from './serverShipments.js';
import { writeOrderCsv } from './orderTransferCsv.js';
import { writeOrderWorkbook } from './orderTransferWorkbook.js';

test('shipment mutation paths preserve typed composite identity', () => {
  for (const type of ['Kit', 'IT', 'Lupin', 'SPT']) {
    assert.equal(mutationPath({ type, id: '8bf8a992-3e1b-4406-9784-94a641da1102' }, 'ship'),
      `/${type}/8bf8a992-3e1b-4406-9784-94a641da1102/ship`);
  }
  assert.match(todayISO(), /^\d{4}-\d{2}-\d{2}$/);
});

test('shipment CSV/XLSX exports retain exact amount and neutralize spreadsheet text', async () => {
  const row = shipmentExportRows([{ type: 'Kit', number: '=HYPERLINK("bad")', date: '2026-10-29',
    value: '123456789012345.67', doctor: 'Doctor', mr: 'MR', recipient: 'Recipient',
    address: '=command', courier: 'Courier', trackingId: '+987654',
    expectedDeliveryDate: '2026-10-30', actualDeliveryDate: null,
    shippedAt: '2026-10-29T15:00:00+00:00', status: 'Shipped', paymentStatus: 'Unpaid' }])[0];
  assert.equal(row.length, 16);
  assert.equal(row[3], '123456789012345.67');
  assert.equal(row[13], '2026-10-29');
  const csv = writeOrderCsv([row]);
  assert.match(csv, /'=(?:HYPERLINK|command)/);
  assert.match(csv, /'\+987654/);
  assert.match(csv, /123456789012345\.67/);
  const xlsx = writeOrderWorkbook([row]);
  assert.equal(xlsx.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.ok(xlsx.size > 0);
});
