import React from 'react';
import { Link } from 'react-router-dom';
import { Search, FileText, Clock, ChevronLeft, ChevronRight, ArrowUpDown, Download, Trash2 } from 'lucide-react';
import { useDocuments } from '../hooks/useDocuments';
import StatusBadge from '../components/StatusBadge';
import { getBulkExportUrl, apiClient } from '../api/client';

const DashboardPage: React.FC = () => {
  const {
    documents, total, loading, error,
    search, setSearch,
    statusFilter, setStatusFilter,
    sortBy, setSortBy,
    sortOrder, setSortOrder,
    page, setPage,
    pageSize,
    refreshDocuments
  } = useDocuments();

  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (deletingId === id) {
      try {
        await apiClient.delete(`/api/documents/${id}`);
        refreshDocuments();
      } catch (err) {
        console.error('Failed to delete document:', err);
      } finally {
        setDeletingId(null);
      }
    } else {
      setDeletingId(id);
      // Reset after 3 seconds
      setTimeout(() => setDeletingId(null), 3000);
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
          <a href={getBulkExportUrl('json')} className="btn btn-secondary btn-sm" download>
            <Download size={14} /> Export JSON
          </a>
          <a href={getBulkExportUrl('csv')} className="btn btn-secondary btn-sm" download>
            <Download size={14} /> Export CSV
          </a>
        </div>
      </div>

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
                  
                  {/* Delete Action Overlay */}
                  <div 
                    className="doc-card-actions" 
                    onClick={(e) => handleDelete(doc.id, e)}
                    style={{
                      position: 'absolute',
                      top: '12px',
                      right: '12px',
                      padding: '8px',
                      borderRadius: '8px',
                      background: deletingId === doc.id ? 'var(--accent-danger)' : 'rgba(255,255,255,0.05)',
                      color: deletingId === doc.id ? 'white' : 'var(--text-muted)',
                      transition: 'all 0.2s ease',
                      zIndex: 10,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: 'var(--font-xs)',
                      fontWeight: 600,
                      backdropFilter: 'blur(4px)',
                    }}
                  >
                    {deletingId === doc.id ? 'Confirm?' : <Trash2 size={16} />}
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
    </div>
  );
};

export default DashboardPage;
