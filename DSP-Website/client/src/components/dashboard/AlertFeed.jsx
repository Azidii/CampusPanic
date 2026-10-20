import React, { useState } from 'react';
import { useAlerts } from '../../context/AlertContext';
import { AlertCard } from './AlertCard';
import { Modal } from '../common/Modal';
import { ThreatBadge } from '../common/Badge';
import {
  ShieldAlert,
  Filter,
  RefreshCw,
  Bell,
  Search,
  ExternalLink
} from 'lucide-react';

export const AlertFeed = () => {
  const {
    alerts,
    loading,
    latestAlert,
    filters,
    setFilters,
    fetchAlerts,
    acknowledgeAlert,
    resolveAlert
  } = useAlerts();

  const [selectedAlertForModal, setSelectedAlertForModal] = useState(null);

  const handleFilterChange = (key, value) => {
    const updated = { ...filters, [key]: value };
    setFilters(updated);
    fetchAlerts(updated);
  };

  return (
    <div>
      {/* Highlight Latest Alert Banner (if there is an active alert) */}
      {latestAlert && latestAlert.status !== 'resolved' && (
        <div className="latest-alert-banner">
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                backgroundColor: 'rgba(239, 68, 68, 0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ef4444',
                flexShrink: 0
              }}
            >
              <ShieldAlert size={24} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                <span style={{ fontWeight: 800, fontSize: '0.95rem', color: '#f8fafc', letterSpacing: '0.02em' }}>
                  LATEST INCIDENT:
                </span>
                <ThreatBadge
                  threatStatus={latestAlert.threatStatus}
                  emergencyType={latestAlert.emergencyType}
                />
              </div>
              <div style={{ fontSize: '0.85rem', color: '#cbd5e1' }}>
                Location: <strong>{latestAlert.building} — {latestAlert.room}</strong> (Node {latestAlert.nodeId}) • Triggered at {new Date(latestAlert.timestamp).toLocaleTimeString()}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            {latestAlert.status === 'new' && (
              <button
                className="btn btn-warning btn-sm"
                onClick={() => acknowledgeAlert(latestAlert._id)}
              >
                Acknowledge
              </button>
            )}
            <button
              className="btn btn-primary btn-sm"
              onClick={() => resolveAlert(latestAlert._id)}
            >
              Resolve
            </button>
          </div>
        </div>
      )}

      {/* Filter and Control Toolbar */}
      <div
        className="card"
        style={{
          padding: '14px 18px',
          marginBottom: '20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            <Filter size={16} />
            <span>Filters:</span>
          </div>

          {/* Status Filter */}
          <select
            className="form-select"
            style={{ width: 'auto', padding: '6px 12px', fontSize: '0.84rem' }}
            value={filters.status}
            onChange={(e) => handleFilterChange('status', e.target.value)}
          >
            <option value="all">All Statuses</option>
            <option value="new">New Alerts Only</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="resolved">Resolved Incidents</option>
          </select>

          {/* Type Filter */}
          <select
            className="form-select"
            style={{ width: 'auto', padding: '6px 12px', fontSize: '0.84rem' }}
            value={filters.type}
            onChange={(e) => handleFilterChange('type', e.target.value)}
          >
            <option value="all">All Emergency Types</option>
            <option value="gunshot">Gunshots (Acoustic / Vision)</option>
            <option value="medical">Medical Emergencies</option>
            <option value="fire">Fire Alarms</option>
            <option value="panic">Panic Buttons</option>
          </select>

          {/* Building Filter */}
          <select
            className="form-select"
            style={{ width: 'auto', padding: '6px 12px', fontSize: '0.84rem' }}
            value={filters.building}
            onChange={(e) => handleFilterChange('building', e.target.value)}
          >
            <option value="all">All Campus Buildings</option>
            <option value="Science Complex">Science Complex</option>
            <option value="Engineering Hall">Engineering Hall</option>
          </select>
        </div>

        <button
          className="btn btn-outline btn-sm"
          onClick={() => fetchAlerts()}
          disabled={loading}
          title="Refresh Alerts Feed"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Alert Feed Stream */}
      {loading && alerts.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
          <RefreshCw size={28} className="animate-spin" style={{ margin: '0 auto 12px' }} />
          <div>Synchronizing live emergency alert feed...</div>
        </div>
      ) : alerts.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text-muted)' }}>
          <Bell size={36} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
          <h4 style={{ color: 'var(--text-primary)', marginBottom: '4px' }}>No Alerts Recorded</h4>
          <p style={{ fontSize: '0.88rem' }}>No emergency alerts match the selected filter criteria.</p>
        </div>
      ) : (
        alerts.map((alert) => (
          <AlertCard
            key={alert._id}
            alert={alert}
            onAcknowledge={acknowledgeAlert}
            onResolve={resolveAlert}
            onSelectImage={(a) => setSelectedAlertForModal(a)}
          />
        ))
      )}

      {/* Snapshot Inspection Modal */}
      {selectedAlertForModal && (
        <Modal
          isOpen={Boolean(selectedAlertForModal)}
          onClose={() => setSelectedAlertForModal(null)}
          title={`Webcam Capture Frame — ${selectedAlertForModal.nodeId} (${selectedAlertForModal.building} ${selectedAlertForModal.room})`}
          maxWidth="750px"
          footer={
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Seq #{selectedAlertForModal.sequenceNumber} • Captured {new Date(selectedAlertForModal.timestamp).toLocaleString()}
              </span>
              <button className="btn btn-primary btn-sm" onClick={() => setSelectedAlertForModal(null)}>
                Close Preview
              </button>
            </div>
          }
        >
          <div style={{ background: '#090d16', borderRadius: 'var(--radius-sm)', overflow: 'hidden', textAlign: 'center' }}>
            <img
              src={selectedAlertForModal.imageUrl}
              alt="Verification Frame"
              style={{ maxWidth: '100%', maxHeight: '500px', display: 'block', margin: '0 auto' }}
              onError={(e) => {
                e.target.src = '/uploads/alerts/placeholder_verified_gunshot.svg';
              }}
            />
          </div>
          <div style={{ marginTop: '14px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            <strong>Analysis: </strong>
            {selectedAlertForModal.threatStatus === 'unverified_audio_trigger' ? (
              <span style={{ color: '#f97316' }}>
                Firearm was NOT verified in this frame. Visual classifier returned negative (Confidence: {((selectedAlertForModal.firearmConfidence || 0) * 100).toFixed(1)}%).
              </span>
            ) : selectedAlertForModal.threatStatus === 'verified_threat' ? (
              <span style={{ color: '#ef4444' }}>
                Confirmed firearm detection in frame with {((selectedAlertForModal.firearmConfidence || 0) * 100).toFixed(1)}% vision confidence.
              </span>
            ) : (
              <span>Automated camera frame recorded upon manual alert trigger.</span>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};
