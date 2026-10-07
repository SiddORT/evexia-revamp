import { courierRequest } from '../auth/adminSession.js';

export const listCouriers = (params, signal) => courierRequest('', { params, signal });
export const createCourier = (body) => courierRequest('', { body });
export const getCourier = (id) => courierRequest(`/${id}`);
export const editCourier = (record, values) => courierRequest(`/${record.id}/edit`, { body: { ...values, expected_version: record.version } });
export const statusCourier = (record, status) => courierRequest(`/${record.id}/status`, { body: { status, expected_version: record.version } });
export const deleteCourier = (record) => courierRequest(`/${record.id}/delete`, { body: { expected_version: record.version } });
export const reviewCouriers = (file) => courierRequest('/import/review', { file, params: { filename: file.name } });
export const importCouriers = (file, digest) => courierRequest('/import/commit', { file, params: { filename: file.name, digest, confirm: true } });
export const exportCouriers = (params, format) => courierRequest('/export', { params: { ...params, format }, download: true });

export function downloadCourierFile(blob, format) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `evexia-courier-partner-master.${format}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
