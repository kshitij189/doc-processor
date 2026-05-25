import { useState, useEffect, useCallback } from 'react';
import { fetchDocuments } from '../api/client';
import type { Document } from '../types';

export function useDocuments() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);

  const loadDocuments = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchDocuments({
        search: search || undefined,
        status: statusFilter || undefined,
        sort_by: sortBy,
        sort_order: sortOrder,
        page,
        page_size: pageSize,
      });
      setDocuments(res.documents);
      setTotal(res.total);
    } catch (err: any) {
      setError(err.message || 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, sortBy, sortOrder, page, pageSize]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  // Smart auto-refresh: poll every 5s only if docs are actively processing.
  // When idle (all completed/failed), slow down to 30s to save server CPU.
  useEffect(() => {
    const hasActiveJobs = documents.some(
      (d) => d.status === 'queued' || d.status === 'processing'
    );
    const interval = setInterval(loadDocuments, hasActiveJobs ? 5000 : 30000);
    return () => clearInterval(interval);
  }, [loadDocuments, documents]);

  return {
    documents, total, loading, error,
    search, setSearch,
    statusFilter, setStatusFilter,
    sortBy, setSortBy,
    sortOrder, setSortOrder,
    page, setPage,
    pageSize,
    refresh: loadDocuments,
  };
}
