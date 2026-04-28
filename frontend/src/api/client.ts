import axios from 'axios';
import type { Document, DocumentListResponse, UploadResponse } from '../types';

const API_BASE = '/api';

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
});

// --- Documents ---

export async function uploadDocuments(files: File[]): Promise<UploadResponse> {
  const formData = new FormData();
  files.forEach((file) => formData.append('files', file));
  const { data } = await api.post<UploadResponse>('/documents/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function fetchDocuments(params: {
  search?: string;
  status?: string;
  sort_by?: string;
  sort_order?: string;
  page?: number;
  page_size?: number;
}): Promise<DocumentListResponse> {
  const { data } = await api.get<DocumentListResponse>('/documents', { params });
  return data;
}

export async function fetchDocument(id: string): Promise<Document> {
  const { data } = await api.get<Document>(`/documents/${id}`);
  return data;
}

export async function retryDocument(id: string): Promise<Document> {
  const { data } = await api.post<Document>(`/documents/${id}/retry`);
  return data;
}

export async function updateResult(
  id: string,
  updates: { title?: string; category?: string; summary?: string; keywords?: string[] }
): Promise<Document> {
  const { data } = await api.put<Document>(`/documents/${id}/result`, updates);
  return data;
}

export async function finalizeDocument(id: string): Promise<Document> {
  const { data } = await api.post<Document>(`/documents/${id}/finalize`);
  return data;
}

export function getExportUrl(id: string, format: 'json' | 'csv'): string {
  return `${API_BASE}/documents/${id}/export?format=${format}`;
}

export function getBulkExportUrl(format: 'json' | 'csv', finalizedOnly = true): string {
  return `${API_BASE}/documents/export/bulk?format=${format}&finalized_only=${finalizedOnly}`;
}
