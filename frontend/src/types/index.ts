export interface ProcessingResult {
  id: string;
  document_id: string;
  title: string | null;
  category: string | null;
  summary: string | null;
  keywords: string[];
  meta_data: Record<string, any>;
  raw_text: string | null;
  created_at: string;
  updated_at: string;
}

export interface Document {
  id: string;
  filename: string;
  file_type: string;
  file_size: number;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  is_finalized: boolean;
  celery_task_id: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  result: ProcessingResult | null;
}

export interface DocumentListResponse {
  documents: Document[];
  total: number;
  page: number;
  page_size: number;
}

export interface ProgressEvent {
  document_id: string;
  stage: string;
  progress: number;
  message: string;
  timestamp: string;
}

export interface UploadResponse {
  documents: Document[];
  message: string;
}

// --- Chat / RAG Types ---

export interface ChatSource {
  text: string;
  document_id: string;
  chunk_index: number;
  score: number;
}

export interface ChatResponse {
  answer: string;
  sources: ChatSource[];
  pipeline_info: Record<string, any>;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: ChatSource[];
  pipeline_info?: Record<string, any>;
  timestamp: Date;
}

export interface RAGStatus {
  api_key_configured: boolean;
  embedding_model: string;
  reranker_model: string;
  collections: number;
  total_chunks: number;
}

export interface ChatSession {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  messages?: ChatMessage[];
}

// --- Auth Types ---

export interface User {
  id: string;
  email: string;
  name: string | null;
  created_at: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  user: User;
}
