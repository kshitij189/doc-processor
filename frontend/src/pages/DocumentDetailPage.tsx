import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft, RefreshCw, CheckCircle, Download, Save,
  FileText, Clock, HardDrive, Tag, Trash2, AlertTriangle, X
} from 'lucide-react';
import { fetchDocument, retryDocument, updateResult, finalizeDocument, getExportUrl, deleteDocument } from '../api/client';
import { useSSE } from '../hooks/useSSE';
import StatusBadge from '../components/StatusBadge';
import ProgressBar from '../components/ProgressBar';
import type { Document } from '../types';

/** Normalize whitespace for fuzzy text matching */
const normalizeWS = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Component that highlights a matching snippet within raw text */
const HighlightedText: React.FC<{
  rawText: string;
  highlightText: string;
  highlightRef: React.RefObject<HTMLElement>;
}> = ({ rawText, highlightText, highlightRef }) => {
  // Try exact match first
  let idx = rawText.indexOf(highlightText);

  if (idx !== -1) {
    const before = rawText.substring(0, idx);
    const match = rawText.substring(idx, idx + highlightText.length);
    const after = rawText.substring(idx + highlightText.length);
    return (
      <>
        {before}
        <mark ref={highlightRef as any} className="citation-highlight">{match}</mark>
        {after}
      </>
    );
  }

  // Fuzzy fallback: normalize whitespace and search
  const normalizedRaw = normalizeWS(rawText);
  const normalizedHighlight = normalizeWS(highlightText);
  const fuzzyIdx = normalizedRaw.indexOf(normalizedHighlight);

  if (fuzzyIdx !== -1) {
    // Map normalized index back to original text approximately
    // Walk through original text to find the corresponding position
    let origStart = 0;
    let normCount = 0;
    let inWhitespace = false;
    
    for (let i = 0; i < rawText.length && normCount < fuzzyIdx; i++) {
      if (/\s/.test(rawText[i])) {
        if (!inWhitespace) {
          normCount++; // counts as one space in normalized
          inWhitespace = true;
        }
      } else {
        normCount++;
        inWhitespace = false;
      }
      origStart = i + 1;
    }

    // Find a reasonable end by searching for the last ~40 chars of the highlight
    const tailSnippet = highlightText.trim().slice(-40);
    let origEnd = rawText.indexOf(tailSnippet, origStart);
    if (origEnd !== -1) {
      origEnd += tailSnippet.length;
    } else {
      // Fallback: estimate length
      origEnd = Math.min(origStart + highlightText.length + 50, rawText.length);
    }

    const before = rawText.substring(0, origStart);
    const match = rawText.substring(origStart, origEnd);
    const after = rawText.substring(origEnd);
    return (
      <>
        {before}
        <mark ref={highlightRef as any} className="citation-highlight">{match}</mark>
        {after}
      </>
    );
  }

  // No match found — show full text without highlight
  return <>{rawText}</>;
};


const DocumentDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const highlightText = (location.state as any)?.highlightText || null;
  const highlightRef = useRef<HTMLElement>(null);
  const [doc, setDoc] = useState<Document | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  // Auto-scroll to highlighted citation when arriving from Chat
  useEffect(() => {
    if (highlightText && highlightRef.current && doc) {
      setTimeout(() => {
        highlightRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
    }
  }, [highlightText, doc]);

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

  const handleDelete = async () => {
    if (!id) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteDocument(id);
      navigate('/', { replace: true });
    } catch (err: any) {
      setDeleteError(err.response?.data?.detail || err.message || 'Failed to delete document');
      setIsDeleting(false);
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
    <>
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
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
                <h3 style={{ fontSize: 'var(--font-base)', fontWeight: 600 }}>
                  Raw Text Preview
                </h3>
                {highlightText && (
                  <button
                    className="btn btn-secondary btn-sm clear-highlight-btn"
                    onClick={() => navigate(location.pathname, { replace: true, state: {} })}
                  >
                    <X size={12} />
                    Clear highlight
                  </button>
                )}
              </div>
              <div className="raw-text-preview">
                {highlightText ? (
                  <HighlightedText
                    rawText={doc.result.raw_text}
                    highlightText={highlightText}
                    highlightRef={highlightRef}
                  />
                ) : (
                  <>
                    {doc.result.raw_text.substring(0, 2000)}
                    {doc.result.raw_text.length > 2000 && '\n\n... (truncated)'}
                  </>
                )}
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

            {/* Delete */}
            <button
              className="btn btn-danger-outline"
              onClick={() => { setShowDeleteModal(true); setDeleteError(null); }}
              style={{
                background: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: 'var(--accent-danger)',
                gap: 'var(--space-2)',
              }}
            >
              <Trash2 size={16} /> Delete Document
            </button>
          </div>
        </div>
      </div>
    </div>

    {/* Delete Confirmation Modal */}
    {showDeleteModal && (
      <div className="modal-overlay" onClick={() => !isDeleting && setShowDeleteModal(false)} style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        animation: 'fadeIn 0.2s ease',
      }}>
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-xl)',
            padding: 'var(--space-6)',
            maxWidth: '460px',
            width: '90%',
            animation: 'slideUp 0.25s ease',
          }}
        >
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '56px',
            height: '56px',
            borderRadius: '50%',
            background: 'rgba(239, 68, 68, 0.12)',
            margin: '0 auto var(--space-4)',
          }}>
            <AlertTriangle size={28} style={{ color: 'var(--accent-danger)' }} />
          </div>

          <h2 style={{
            fontSize: 'var(--font-lg)',
            fontWeight: 700,
            textAlign: 'center',
            marginBottom: 'var(--space-2)',
            color: 'var(--text-primary)',
          }}>
            Delete Document
          </h2>

          <p style={{
            textAlign: 'center',
            color: 'var(--text-secondary)',
            fontSize: 'var(--font-sm)',
            marginBottom: 'var(--space-4)',
            lineHeight: 1.6,
          }}>
            Are you sure you want to delete <strong style={{ color: 'var(--text-primary)' }}>"{doc.filename}"</strong>?
          </p>

          <div style={{
            background: 'rgba(239, 68, 68, 0.06)',
            border: '1px solid rgba(239, 68, 68, 0.15)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-3) var(--space-4)',
            marginBottom: 'var(--space-5)',
            fontSize: 'var(--font-xs)',
            color: 'var(--text-secondary)',
            lineHeight: 1.8,
          }}>
            <div style={{ fontWeight: 600, marginBottom: '4px', color: 'var(--accent-danger)' }}>
              This will permanently remove:
            </div>
            <div>• All chunks from the <strong>RAG vector index</strong></div>
            <div>• The uploaded <strong>file from disk</strong></div>
            <div>• All <strong>processing results & metadata</strong></div>
          </div>

          {deleteError && (
            <div className="alert alert-error" style={{ marginBottom: 'var(--space-4)', fontSize: 'var(--font-xs)' }}>
              {deleteError}
            </div>
          )}

          <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
            <button
              className="btn btn-secondary"
              onClick={() => setShowDeleteModal(false)}
              disabled={isDeleting}
              style={{ flex: 1 }}
            >
              Cancel
            </button>
            <button
              className="btn btn-danger"
              onClick={handleDelete}
              disabled={isDeleting}
              style={{
                flex: 1,
                opacity: isDeleting ? 0.7 : 1,
              }}
            >
              <Trash2 size={14} />
              {isDeleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
};

export default DocumentDetailPage;
