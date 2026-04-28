import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, RefreshCw, CheckCircle, Download, Save,
  FileText, Clock, HardDrive, Tag
} from 'lucide-react';
import { fetchDocument, retryDocument, updateResult, finalizeDocument, getExportUrl } from '../api/client';
import { useSSE } from '../hooks/useSSE';
import StatusBadge from '../components/StatusBadge';
import ProgressBar from '../components/ProgressBar';
import type { Document } from '../types';

const DocumentDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [doc, setDoc] = useState<Document | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  // Edit form state
  const [editTitle, setEditTitle] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editSummary, setEditSummary] = useState('');
  const [editKeywords, setEditKeywords] = useState('');

  // SSE for live progress
  const shouldSubscribe = doc?.status === 'queued' || doc?.status === 'processing';
  const { progress } = useSSE(shouldSubscribe ? id! : null);

  const loadDoc = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const data = await fetchDocument(id);
      setDoc(data);
      // Populate edit form
      if (data.result) {
        setEditTitle(data.result.title || '');
        setEditCategory(data.result.category || '');
        setEditSummary(data.result.summary || '');
        setEditKeywords(data.result.keywords?.join(', ') || '');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load document');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadDoc();
  }, [loadDoc]);

  // Refresh when processing completes via SSE
  useEffect(() => {
    if (progress?.stage === 'job_completed' || progress?.stage === 'job_failed') {
      setTimeout(loadDoc, 1000);
    }
  }, [progress?.stage, loadDoc]);

  const handleRetry = async () => {
    if (!id) return;
    try {
      setActionMsg(null);
      const updated = await retryDocument(id);
      setDoc(updated);
      setActionMsg('Retry queued successfully');
    } catch (err: any) {
      setActionMsg(`Retry failed: ${err.response?.data?.detail || err.message}`);
    }
  };

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    setActionMsg(null);
    try {
      const updated = await updateResult(id, {
        title: editTitle,
        category: editCategory,
        summary: editSummary,
        keywords: editKeywords.split(',').map((k) => k.trim()).filter(Boolean),
      });
      setDoc(updated);
      setActionMsg('Changes saved successfully');
    } catch (err: any) {
      setActionMsg(`Save failed: ${err.response?.data?.detail || err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleFinalize = async () => {
    if (!id) return;
    try {
      setActionMsg(null);
      const updated = await finalizeDocument(id);
      setDoc(updated);
      setActionMsg('Document finalized successfully');
    } catch (err: any) {
      setActionMsg(`Finalize failed: ${err.response?.data?.detail || err.message}`);
    }
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  const formatDate = (dateStr: string): string => {
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  };

  if (loading) {
    return <div className="loading-center"><div className="spinner" /></div>;
  }

  if (error || !doc) {
    return (
      <div>
        <div className="alert alert-error">{error || 'Document not found'}</div>
        <Link to="/" className="btn btn-secondary"><ArrowLeft size={16} /> Back</Link>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
        <Link to="/" className="btn btn-secondary btn-icon btn-sm">
          <ArrowLeft size={16} />
        </Link>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 'var(--font-xl)', fontWeight: 700 }}>{doc.filename}</h1>
          <div className="flex items-center gap-3" style={{ marginTop: '4px' }}>
            <StatusBadge status={doc.status} isFinalized={doc.is_finalized} />
            <span className="text-sm text-muted">
              <Clock size={12} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
              {formatDate(doc.created_at)}
            </span>
          </div>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={loadDoc}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {actionMsg && (
        <div className={`alert ${actionMsg.includes('fail') || actionMsg.includes('Failed') ? 'alert-error' : 'alert-success'}`}>
          {actionMsg}
        </div>
      )}

      {/* Progress (for queued/processing) */}
      {(doc.status === 'queued' || doc.status === 'processing') && (
        <div className="card" style={{ marginBottom: 'var(--space-6)' }}>
          <h3 style={{ fontSize: 'var(--font-base)', fontWeight: 600, marginBottom: 'var(--space-3)' }}>
            Processing Progress
          </h3>
          <ProgressBar progress={progress} />
          {!progress && (
            <p className="text-sm text-muted">Waiting for processing to begin...</p>
          )}
        </div>
      )}

      {/* Error message */}
      {doc.status === 'failed' && doc.error_message && (
        <div className="alert alert-error" style={{ marginBottom: 'var(--space-6)' }}>
          <span>⚠ Processing Error: {doc.error_message}</span>
        </div>
      )}

      <div className="detail-grid">
        {/* Left Column: Document Info */}
        <div>
          <div className="card">
            <div className="detail-section">
              <h3><FileText size={18} /> Document Info</h3>
              <div className="detail-field">
                <div className="detail-field-label">Filename</div>
                <div className="detail-field-value">{doc.filename}</div>
              </div>
              <div className="detail-field">
                <div className="detail-field-label">File Type</div>
                <div className="detail-field-value">{doc.file_type}</div>
              </div>
              <div className="detail-field">
                <div className="detail-field-label">File Size</div>
                <div className="detail-field-value">
                  <HardDrive size={12} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                  {formatSize(doc.file_size)}
                </div>
              </div>
              <div className="detail-field">
                <div className="detail-field-label">Status</div>
                <div className="detail-field-value">
                  <StatusBadge status={doc.status} isFinalized={doc.is_finalized} />
                </div>
              </div>
              <div className="detail-field">
                <div className="detail-field-label">Created</div>
                <div className="detail-field-value">{formatDate(doc.created_at)}</div>
              </div>
              <div className="detail-field">
                <div className="detail-field-label">Last Updated</div>
                <div className="detail-field-value">{formatDate(doc.updated_at)}</div>
              </div>
              {doc.celery_task_id && (
                <div className="detail-field">
                  <div className="detail-field-label">Task ID</div>
                  <div className="detail-field-value" style={{ fontFamily: 'monospace', fontSize: 'var(--font-xs)' }}>
                    {doc.celery_task_id}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Raw Text Preview */}
          {doc.result?.raw_text && (
            <div className="card" style={{ marginTop: 'var(--space-4)' }}>
              <h3 style={{ fontSize: 'var(--font-base)', fontWeight: 600, marginBottom: 'var(--space-3)' }}>
                Raw Text Preview
              </h3>
              <div className="raw-text-preview">
                {doc.result.raw_text.substring(0, 2000)}
                {doc.result.raw_text.length > 2000 && '\n\n... (truncated)'}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Extracted Result + Edit */}
        <div>
          {doc.result ? (
            <div className="card">
              <div className="detail-section">
                <h3><Tag size={18} /> Extracted Result</h3>

                <div className="form-group">
                  <label className="form-label">Title</label>
                  <input
                    type="text"
                    className="form-input"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    disabled={doc.is_finalized}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Category</label>
                  <input
                    type="text"
                    className="form-input"
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    disabled={doc.is_finalized}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Summary</label>
                  <textarea
                    className="form-textarea"
                    value={editSummary}
                    onChange={(e) => setEditSummary(e.target.value)}
                    disabled={doc.is_finalized}
                    rows={4}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Keywords (comma-separated)</label>
                  <input
                    type="text"
                    className="form-input"
                    value={editKeywords}
                    onChange={(e) => setEditKeywords(e.target.value)}
                    disabled={doc.is_finalized}
                  />
                </div>

                {doc.result.keywords && doc.result.keywords.length > 0 && (
                  <div className="keywords-list" style={{ marginBottom: 'var(--space-4)' }}>
                    {doc.result.keywords.map((kw, i) => (
                      <span key={i} className="keyword-tag">{kw}</span>
                    ))}
                  </div>
                )}

                {doc.result.meta_data && Object.keys(doc.result.meta_data).length > 0 && (
                  <div className="detail-field">
                    <div className="detail-field-label">Metadata</div>
                    <div className="detail-field-value" style={{ fontFamily: 'monospace', fontSize: 'var(--font-xs)' }}>
                      {JSON.stringify(doc.result.meta_data, null, 2)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : doc.status === 'completed' ? (
            <div className="card">
              <p className="text-muted">No processing result available.</p>
            </div>
          ) : null}

          {/* Actions */}
          <div className="detail-actions" style={{ borderTop: 'none', paddingTop: 0, marginTop: 'var(--space-4)' }}>
            {/* Save edits */}
            {doc.result && doc.status === 'completed' && !doc.is_finalized && (
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                <Save size={16} /> {saving ? 'Saving...' : 'Save Changes'}
              </button>
            )}

            {/* Finalize */}
            {doc.status === 'completed' && !doc.is_finalized && (
              <button className="btn btn-success" onClick={handleFinalize}>
                <CheckCircle size={16} /> Finalize
              </button>
            )}

            {/* Retry */}
            {doc.status === 'failed' && (
              <button className="btn btn-danger" onClick={handleRetry}>
                <RefreshCw size={16} /> Retry Processing
              </button>
            )}

            {/* Export */}
            {doc.result && (
              <>
                <a href={getExportUrl(doc.id, 'json')} className="btn btn-secondary" download>
                  <Download size={16} /> Export JSON
                </a>
                <a href={getExportUrl(doc.id, 'csv')} className="btn btn-secondary" download>
                  <Download size={16} /> Export CSV
                </a>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DocumentDetailPage;
