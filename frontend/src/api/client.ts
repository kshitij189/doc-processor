import axios from 'axios';
import type { Document, DocumentListResponse, UploadResponse, ChatResponse, RAGStatus, ChatSession } from '../types';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

export const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
  timeout: 60000, // 60 seconds timeout to handle Render free tier cold starts
});

// --- Auth Interceptors ---

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('dp_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// The free instance spins down when idle and restarts on every deploy. While it
// is coming back up, Render's edge answers with a gateway error that carries no
// CORS header, so the browser surfaces it as "Network Error" (or as a CORS
// violation in the console) rather than as the temporary outage it is. Retry
// those instead of failing the page.
const MAX_RETRIES = 3;
const TRANSIENT_STATUSES = [502, 503, 504];

const isTransient = (error: any): boolean => {
  // No response at all means the request never completed: a gateway error
  // stripped of CORS headers, a dropped connection, or a cold-start timeout.
  if (!error.response) return true;
  return TRANSIENT_STATUSES.includes(error.response.status);
};

// Only replay requests that are safe to repeat. An upload must never be retried
// automatically — it could store the same document twice.
const isRetryable = (config: any): boolean =>
  !!config && (config.method ?? 'get').toLowerCase() === 'get';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Redirect to login on 401 (but not for auth endpoints themselves)
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (
      error.response?.status === 401 &&
      !error.config?.url?.includes('/auth/')
    ) {
      localStorage.removeItem('dp_token');
      localStorage.removeItem('dp_user');
      window.location.href = '/login';
      return Promise.reject(error);
    }

    const config = error.config;
    if (isRetryable(config) && isTransient(error)) {
      config.__retryCount = (config.__retryCount ?? 0) + 1;
      if (config.__retryCount <= MAX_RETRIES) {
        // 1s, 2s, 4s — a cold start typically needs 30-50s, so this covers a
        // restart without hammering a server that is already struggling.
        await delay(1000 * 2 ** (config.__retryCount - 1));
        return api(config);
      }
      error.message =
        'Could not reach the server. It may be starting up after being idle — ' +
        'wait a moment and refresh.';
    }

    return Promise.reject(error);
  }
);

// --- Documents ---

export async function uploadDocuments(files: File[]): Promise<UploadResponse> {
  const formData = new FormData();
  files.forEach((file) => formData.append('files', file));
  const { data } = await api.post<UploadResponse>('/documents/upload', formData, {
    headers: { 'Content-Type': undefined },
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

export async function downloadDocumentExport(id: string, format: 'json' | 'csv'): Promise<void> {
  const response = await api.get(`/documents/${id}/export?format=${format}`, {
    responseType: 'blob',
  });
  const blob = new Blob([response.data], { type: format === 'json' ? 'application/json' : 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `document_${id}.${format}`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }, 500);
}

export async function deleteDocument(id: string): Promise<void> {
  await api.delete(`/documents/${id}`);
}

export async function downloadBulkExport(format: 'json' | 'csv', finalizedOnly = true): Promise<void> {
  const response = await api.get(`/documents/export/bulk?format=${format}&finalized_only=${finalizedOnly}`, {
    responseType: 'blob',
  });
  const blob = new Blob([response.data], { type: format === 'json' ? 'application/json' : 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `documents_export.${format}`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }, 500);
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

  const token = localStorage.getItem('dp_token');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  fetch(`${API_BASE}/chat/stream`, {
    method: 'POST',
    headers,
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
