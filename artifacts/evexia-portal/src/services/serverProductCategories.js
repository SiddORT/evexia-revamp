import { productCategoryRequest } from '../auth/adminSession.js';
import { downloadServerBlob } from './downloads.js';

export const listProductCategories = (params, signal) => productCategoryRequest('', { params, signal });
export const createProductCategory = (body) => productCategoryRequest('', { body });
export const getProductCategory = (id) => productCategoryRequest(`/${id}`);
export const editProductCategory = (record, values) => productCategoryRequest(`/${record.id}/edit`, { body: { ...values, expected_version: record.version } });
export const statusProductCategory = (record, status) => productCategoryRequest(`/${record.id}/status`, { body: { status, expected_version: record.version } });
export const deleteProductCategory = (record) => productCategoryRequest(`/${record.id}/delete`, { body: { expected_version: record.version } });
export const reviewProductCategories = (file) => productCategoryRequest('/import/review', { file, params: { filename: file.name } });
export const importProductCategories = (file, digest) => productCategoryRequest('/import/commit', { file, params: { filename: file.name, digest, confirm: true } });
export const exportProductCategories = (params, format, signal) => productCategoryRequest('/export', { params: { ...params, format }, download: true, signal });
export const sampleProductCategories = (format, signal) => productCategoryRequest('/sample', { params: { format }, download: true, signal });
export const downloadProductCategoryFile = (blob, format, sample = false) => downloadServerBlob(blob, `evexia-product-category-${sample ? 'template' : 'master'}.${format}`);
