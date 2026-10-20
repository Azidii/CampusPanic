import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert, ArrowLeft } from 'lucide-react';

export const NotFoundPage = () => {
  return (
    <div style={{ textAlign: 'center', padding: '80px 20px' }}>
      <ShieldAlert size={60} color="#ef4444" style={{ margin: '0 auto 16px' }} />
      <h1 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '8px' }}>404 — Channel Not Found</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '24px' }}>
        The security console endpoint you are looking for does not exist or has been relocated.
      </p>
      <Link to="/" className="btn btn-primary" style={{ display: 'inline-flex' }}>
        <ArrowLeft size={16} /> Return to Operations Dashboard
      </Link>
    </div>
  );
};
