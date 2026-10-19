// Synthetic presentation fixture. Served only by Vite for the preview spec;
// never imported by the application entry and never uses real accounts or writes.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import StorageLocationAddress from '../../src/components/admin/StorageLocationAddress.jsx';
import MRForm from '../../src/components/admin/MRForm.jsx';
import DoctorForm from '../../src/components/admin/DoctorForm.jsx';
import PatientForm from '../../src/components/admin/PatientForm.jsx';
import { loginAdmin, logoutAdmin } from '../../src/auth/adminSession.js';
import '../../src/admin.css';
import '../../src/mr.css';

const host = document.createElement('div');
host.className = 'admin-shell';
document.body.append(host);
const root = createRoot(host);
function Storage({ record, editing }) {
  const [values, setValues] = useState(record);
  return <form onSubmit={(event) => event.preventDefault()} className="mr-form">
    <StorageLocationAddress values={values} errors={{}} editing={editing}
      onChange={(patch) => setValues((current) => ({ ...current, ...patch }))} />
    <label htmlFor="storage-address">Street address</label>
    <input id="storage-address" value={values.address} onChange={(event) =>
      setValues((current) => ({ ...current, address: event.target.value }))} />
    <button type="submit">Save fixture</button>
  </form>;
}
window.geographyFixture = {
  login: () => loginAdmin('synthetic@example.test', 'synthetic-password', false),
  logout: logoutAdmin,
  mount(kind, editing, historical = false) {
    const record = { id: 'synthetic-record', country: '', countryCode: '', state: '', city: '',
      address: 'Original street draft', addressLine1: 'Original street draft', pincode: '',
      ...(historical ? { country: 'India', countryCode: 'IN', state: 'Maharashtra', city: 'Historical locality' } : {}) };
    const props = { key: `${kind}-${editing}-${historical}`, onSave: async () => ({ success: true }), onClose() {} };
    const Component = kind === 'storage' ? <Storage {...props} record={record} editing={editing} />
      : kind === 'mr' ? <MRForm {...props} mr={editing ? record : undefined} />
        : kind === 'doctor' ? <DoctorForm {...props} doctor={editing ? record : undefined} />
          : <PatientForm {...props} patient={editing ? record : undefined} />;
    root.render(Component);
  },
};
window.fixtureSubmits = 0;
document.addEventListener('submit', () => { window.fixtureSubmits++; }, true);
