import React from 'react';
import { Link } from 'react-router-dom';
import { Search, FileText, Clock, ChevronLeft, ChevronRight, ArrowUpDown, Download, Trash2, AlertTriangle, X } from 'lucide-react';
import { useDocuments } from '../hooks/useDocuments';
import StatusBadge from '../components/StatusBadge';
import { downloadBulkExport, deleteDocument } from '../api/client';

const DashboardPage: React.FC = () => {
  const {
    documents, total, loading, error,
    search, setSearch,
    statusFilter, setStatusFilter,
    sortBy, setSortBy,
    sortOrder, setSortOrder,
    page, setPage,
    pageSize,
    refresh
  } = useDocuments();

  const [deleteTarget, setDeleteTarget] = React.useState<{ id: string; filename: string } | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const [deleteSuccess, setDeleteSuccess] = React.useState<string | null>(null);

  const openDeleteModal = (id: string, filename: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDeleteTarget({ id, filename });
    setDeleteError(null);
  };

  const closeDeleteModal = () => {
    if (deleting) return;
    setDeleteTarget(null);
    setDeleteError(null);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteDocument(deleteTarget.id);
      setDeleteSuccess(`"${deleteTarget.filename}" has been deleted and removed from the RAG index.`);
      setDeleteTarget(null);
      refresh();
      // Auto-clear success message
      setTimeout(() => setDeleteSuccess(null), 5000);
    } catch (err: any) {
      setDeleteError(err.response?.data?.detail || err.message || 'Failed to delete document');
    } finally {
      setDeleting(false);
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  const formatDate = (dateStr: string): string => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Compute stats
  const stats = {
    total,
    queued: documents.filter((d) => d.status === 'queued').length,
    processing: documents.filter((d) => d.status === 'processing').length,
    completed: documents.filter((d) => d.status === 'completed').length,
    failed: documents.filter((d) => d.status === 'failed').length,
  };

  const toggleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Document Dashboard</h1>
          <p>Track and manage your document processing pipeline</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => downloadBulkExport('json')} className="btn btn-secondary btn-sm">
            <Download size={14} /> Export JSON
          </button>
          <button onClick={() => downloadBulkExport('csv')} className="btn btn-secondary btn-sm">
            <Download size={14} /> Export CSV
          </button>
        </div>
      </div>

      {/* Success Toast */}
      {deleteSuccess && (
        <div className="delete-toast" style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          padding: 'var(--space-3) var(--space-4)',
          marginBottom: 'var(--space-4)',
          background: 'rgba(16, 185, 129, 0.12)',
          border: '1px solid rgba(16, 185, 129, 0.3)',
          borderRadius: 'var(--radius-lg)',
          color: 'var(--accent-success)',
          fontSize: 'var(--font-sm)',
          fontWeight: 500,
          animation: 'fadeIn 0.3s ease',
        }}>
          <span style={{ flex: 1 }}>{deleteSuccess}</span>
          <button
            onClick={() => setDeleteSuccess(null)}
            style={{
              background: 'none', border: 'none', color: 'inherit',
              cursor: 'pointer', padding: '4px', display: 'flex',
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Stats Row */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-value">{stats.total}</div>
          <div className="stat-label">Total Documents</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--accent-info)' }}>{stats.queued}</div>
          <div className="stat-label">Queued</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--accent-warning)' }}>{stats.processing}</div>
          <div className="stat-label">Processing</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--accent-success)' }}>{stats.completed}</div>
          <div className="stat-label">Completed</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--accent-danger)' }}>{stats.failed}</div>
          <div className="stat-label">Failed</div>
        </div>
      </div>

      {/* Controls */}
      <div className="dashboard-controls">
        <div className="search-wrapper">
          <Search size={16} className="search-icon" />
          <input
            type="text"
            className="form-input"
            placeholder="Search by filename..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <select
          className="form-select"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          style={{ width: '160px' }}
        >
          <option value="">All Status</option>
          <option value="queued">Queued</option>
          <option value="processing">Processing</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => toggleSort('created_at')}
        >
          <ArrowUpDown size={14} />
          Date {sortBy === 'created_at' ? (sortOrder === 'desc' ? '↓' : '↑') : ''}
        </button>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => toggleSort('filename')}
        >
          <ArrowUpDown size={14} />
          Name {sortBy === 'filename' ? (sortOrder === 'desc' ? '↓' : '↑') : ''}
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading && documents.length === 0 ? (
        <div className="loading-center">
          <div className="spinner" />
        </div>
      ) : documents.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <FileText size={32} />
          </div>
          <h3>No documents found</h3>
          <p>Upload your first document to get started</p>
          <Link to="/upload" className="btn btn-primary" style={{ marginTop: 'var(--space-4)' }}>
            Upload Documents
          </Link>
        </div>
      ) : (
        <>
          <div className="document-grid">
            {documents.map((doc) => (
              <Link
                key={doc.id}
                to={`/documents/${doc.id}`}
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <div className="card card-clickable doc-card">
                  <div className="doc-card-header">
                    <div className="doc-card-filename">{doc.filename}</div>
                    <StatusBadge status={doc.status} isFinalized={doc.is_finalized} />
                  </div>
                  {doc.result?.category && (
                    <span className="keyword-tag" style={{ alignSelf: 'flex-start' }}>
                      {doc.result.category}
                    </span>
                  )}
                  <div className="doc-card-meta">
                    <span>{doc.file_type.split('/').pop()?.toUpperCase()}</span>
                    <span>{formatSize(doc.file_size)}</span>
                    <span>
                      <Clock size={12} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                      {formatDate(doc.created_at)}
                    </span>
                  </div>
                  {doc.error_message && (
                    <div style={{ fontSize: 'var(--font-xs)', color: 'var(--accent-danger)', marginTop: '4px' }}>
                      ⚠ {doc.error_message.substring(0, 80)}...
                    </div>
                  )}
                  
                  {/* Delete Button */}
                  <div 
                    className="doc-card-delete-btn"
                    onClick={(e) => openDeleteModal(doc.id, doc.filename, e)}
                    title="Delete document"
                    style={{
                      position: 'absolute',
                      bottom: '12px',
                      right: '12px',
                      padding: '8px',
                      borderRadius: '8px',
                      background: 'rgba(255,255,255,0.05)',
                      color: 'var(--text-muted)',
                      transition: 'all 0.2s ease',
                      zIndex: 10,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: 'var(--font-xs)',
                      fontWeight: 600,
                      backdropFilter: 'blur(4px)',
                      cursor: 'pointer',
                    }}
                  >
                    <Trash2 size={16} />
                  </div>
                </div>
              </Link>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button
                className="btn btn-secondary btn-sm btn-icon"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft size={16} />
              </button>
              <span className="pagination-info">
                Page {page} of {totalPages} ({total} documents)
              </span>
              <button
                className="btn btn-secondary btn-sm btn-icon"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="modal-overlay" onClick={closeDeleteModal} style={{
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
            className="modal-content"
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
            {/* Warning Icon */}
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
              Are you sure you want to delete <strong style={{ color: 'var(--text-primary)' }}>"{deleteTarget.filename}"</strong>?
            </p>

            {/* What will be removed */}
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

            {/* Actions */}
            <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
              <button
                className="btn btn-secondary"
                onClick={closeDeleteModal}
                disabled={deleting}
                style={{ flex: 1 }}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={handleConfirmDelete}
                disabled={deleting}
                style={{
                  flex: 1,
                  background: deleting ? 'var(--accent-danger)' : undefined,
                  opacity: deleting ? 0.7 : 1,
                }}
              >
                <Trash2 size={14} />
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardPage;
