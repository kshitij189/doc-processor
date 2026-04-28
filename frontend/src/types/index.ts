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
