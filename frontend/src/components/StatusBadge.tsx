import React from 'react';

interface StatusBadgeProps {
  status: string;
  isFinalized?: boolean;
}

const StatusBadge: React.FC<StatusBadgeProps> = ({ status, isFinalized }) => {
  if (isFinalized) {
    return (
      <span className="status-badge finalized">
        <span className="status-dot" />
        Finalized
      </span>
    );
  }

  return (
    <span className={`status-badge ${status}`}>
      <span className="status-dot" />
      {status}
    </span>
  );
};

export default StatusBadge;
