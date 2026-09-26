// These examples exist only in memory for the original built-in preview patients.
// IDs alone are insufficient: a CSV import may legitimately reuse an old sample ID.
const SAMPLE_IDENTITIES = [
  { name: 'Sample Patient Ada', dateOfBirth: '1992-04-15' },
  { name: 'Sample Patient Bina', dateOfBirth: '1978-08-22' },
  { name: 'Sample Patient Cyrus', dateOfBirth: '2002-11-03' },
  { name: 'Sample Patient Dev', dateOfBirth: '1965-02-19' },
];

export function samplePatientIndex(record) {
  if (!record) return -1;
  return SAMPLE_IDENTITIES.findIndex((identity, index) =>
    record.id === `PAT-SAMPLE-${String(index + 1).padStart(3, '0')}`
    && record.createdAt === new Date(Date.UTC(2025, 3, index + 1, 10)).toISOString()
    && record.name === identity.name
    && record.dateOfBirth === identity.dateOfBirth
    && record.phone === `00000000${String(index + 1).padStart(2, '0')}`
    && record.email === `sample.patient${index + 1}@example.com`
    && record.addressLine1 === `${index + 1} Sample Street`);
}

const isoDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function getSampleDosageHistory(record, today = new Date()) {
  const index = samplePatientIndex(record);
  if (index < 0) return null;

  // Rolling calendar examples, not a schedule: the next 15th is always today or later.
  const month = today.getMonth() + (today.getDate() > 15 ? 1 : 0);
  const previous = [-2, -1].map((offset, position) => ({
    date: isoDate(new Date(today.getFullYear(), month + offset, 15)),
    name: `Example dose ${position + 1} · ${SAMPLE_IDENTITIES[index].name}`,
  }));
  const upcoming = [0, 1].map((offset, position) => ({
    date: isoDate(new Date(today.getFullYear(), month + offset, 15)),
    name: `Example dose ${position + 3} · ${SAMPLE_IDENTITIES[index].name}`,
  }));
  return { previous, upcoming, last: previous.at(-1), next: upcoming[0] };
}