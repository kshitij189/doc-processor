import React, { useCallback, useRef, useState } from 'react';
import { Upload, X, FileText } from 'lucide-react';
import { uploadDocuments } from '../api/client';
import { useNavigate } from 'react-router-dom';

const UploadForm: React.FC = () => {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files);
    setFiles((prev) => [...prev, ...dropped]);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selected = Array.from(e.target.files);
      setFiles((prev) => [...prev, ...selected]);
    }
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  const handleUpload = async () => {
    if (files.length === 0) return;
    setUploading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await uploadDocuments(files);
      setSuccess(res.message);
      setFiles([]);
      // Navigate to dashboard after short delay
      setTimeout(() => navigate('/'), 1500);
    } catch (err: any) {
      let errorMessage = 'Upload failed';
      if (err.response?.data?.detail) {
        const detail = err.response.data.detail;
        if (typeof detail === 'string') {
          errorMessage = detail;
        } else if (Array.isArray(detail)) {
          errorMessage = detail.map((d: any) => `${d.loc?.[1] || 'field'}: ${d.msg}`).join(', ');
        } else {
          errorMessage = JSON.stringify(detail);
        }
      } else if (err.message) {
        errorMessage = err.message;
      }
      setError(errorMessage);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div
        className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileSelect}
          style={{ display: 'none' }}
          accept=".txt,.pdf,.docx,.csv,.md,.json,.xml,.html"
        />
        <div className="upload-zone-icon">
          <Upload size={28} />
        </div>
        <h3>Drop files here or click to browse</h3>
        <p>Supports TXT, PDF, DOCX, CSV, MD, JSON, XML, HTML — up to 50MB each</p>
      </div>

      {files.length > 0 && (
        <>
          <div className="file-list">
            {files.map((file, idx) => (
              <div key={idx} className="file-item">
                <div className="file-item-info">
                  <FileText size={16} style={{ color: 'var(--accent-primary)' }} />
                  <span>{file.name}</span>
                  <span className="file-item-size">{formatSize(file.size)}</span>
                </div>
                <button
                  className="file-item-remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile(idx);
                  }}
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 'var(--space-6)', display: 'flex', gap: 'var(--space-3)' }}>
            <button
              className="btn btn-primary"
              onClick={handleUpload}
              disabled={uploading}
            >
              {uploading ? (
                <>
                  <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload size={16} />
                  Upload {files.length} file{files.length > 1 ? 's' : ''}
                </>
              )}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => setFiles([])}
              disabled={uploading}
            >
              Clear All
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default UploadForm;
