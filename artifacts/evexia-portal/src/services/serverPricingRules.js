// Shared response/date validation for the combination pricing editor.
export class MalformedResponseError extends Error {
  constructor(what) { super(`The server response for ${what} was not in the expected format.`); this.malformed = true; }
}

export const validDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
