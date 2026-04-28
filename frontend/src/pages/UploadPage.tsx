import React from 'react';
import UploadForm from '../components/UploadForm';

const UploadPage: React.FC = () => {
  return (
    <div>
      <div className="page-header">
        <h1>Upload Documents</h1>
        <p>Upload one or more files to begin processing</p>
      </div>
      <div className="card" style={{ maxWidth: '700px' }}>
        <UploadForm />
      </div>
    </div>
  );
};

export default UploadPage;
