import React from 'react';
import type { ProgressEvent } from '../types';

interface ProgressBarProps {
  progress: ProgressEvent | null;
}

const STAGE_LABELS: Record<string, string> = {
  job_started: 'Job Started',
  document_parsing_started: 'Parsing Document',
  document_parsing_completed: 'Parsing Complete',
  field_extraction_started: 'Extracting Fields',
  field_extraction_completed: 'Extraction Complete',
  storing_result: 'Storing Result',
  job_completed: 'Completed',
  job_failed: 'Failed',
};

const ProgressBar: React.FC<ProgressBarProps> = ({ progress }) => {
  if (!progress) return null;

  const pct = Math.min(100, Math.max(0, progress.progress || 0));
  const label = STAGE_LABELS[progress.stage] || progress.stage;

  return (
    <div className="progress-container">
      <div className="progress-bar-wrapper">
        <div
          className="progress-bar-fill"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="progress-info">
        <span className="progress-stage">{label}</span>
        <span>{pct}%</span>
      </div>
      {progress.message && (
        <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginTop: '4px' }}>
          {progress.message}
        </p>
      )}
    </div>
  );
};

export default ProgressBar;
