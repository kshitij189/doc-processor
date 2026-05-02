import axios from 'axios';
import type { Document, DocumentListResponse, UploadResponse, ChatResponse, RAGStatus, ChatSession } from '../types';

const API_BASE = '/api';

export const api = axios.create({
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

// --- Chat / RAG ---

export async function createChatSession(title: string = "New Conversation"): Promise<ChatSession> {
  const { data } = await api.post<ChatSession>('/chat/sessions', { title });
  return data;
}

export async function fetchChatSessions(): Promise<ChatSession[]> {
  const { data } = await api.get<ChatSession[]>('/chat/sessions');
  return data;
}

export async function fetchChatSession(sessionId: string): Promise<ChatSession> {
  const { data } = await api.get<ChatSession>(`/chat/sessions/${sessionId}`);
  return data;
}

export async function sendChatMessage(
  question: string,
  documentIds?: string[],
  sessionId?: string
): Promise<ChatResponse> {
  const { data } = await api.post<ChatResponse>('/chat', {
    question,
    document_ids: documentIds,
    session_id: sessionId,
  });
  return data;
}

export async function fetchRAGStatus(): Promise<RAGStatus> {
  const { data } = await api.get<RAGStatus>('/chat/status');
  return data;
}

/**
 * Stream chat response via SSE.
 * Calls onToken for each streamed token, onSources for source data, onDone when complete.
 */
export function streamChatMessage(
  question: string,
  documentIds: string[] | undefined,
  sessionId: string | undefined,
  callbacks: {
    onToken: (token: string) => void;
    onSources: (sources: any[], pipelineInfo: any) => void;
    onDone: () => void;
    onError: (error: string) => void;
  }
): AbortController {
  const controller = new AbortController();

  fetch(`${API_BASE}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, document_ids: documentIds, session_id: sessionId }),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        callbacks.onError(`Request failed with status ${response.status}`);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        callbacks.onError('No response body');
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.token !== undefined) {
                callbacks.onToken(data.token);
              } else if (data.sources !== undefined) {
                callbacks.onSources(data.sources, data.pipeline_info);
              } else if (data.status === 'complete') {
                callbacks.onDone();
              }
            } catch {
              // Skip malformed data
            }
          } else if (line.startsWith('event: ')) {
            // SSE event type — handled by data parsing above
          }
        }
      }

      callbacks.onDone();
    })
    .catch((err) => {
      if (err.name !== 'AbortError') {
        callbacks.onError(err.message);
      }
    });

  return controller;
}
