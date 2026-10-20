import React, { useState } from 'react';
import { ThreatBadge, StatusBadge } from '../common/Badge';
import {
  MapPin,
  Clock,
  CheckCircle,
  Eye,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  Hash,
  Activity
} from 'lucide-react';
import { Link } from 'react-router-dom';

export const AlertCard = ({ alert, onAcknowledge, onResolve, onSelectImage }) => {
  const [loadingAction, setLoadingAction] = useState(false);

  const handleAck = async (e) => {
    e.stopPropagation();
    try {
      setLoadingAction(true);
      await onAcknowledge(alert._id);
    } finally {
      setLoadingAction(false);
    }
  };

  const handleResolve = async (e) => {
    e.stopPropagation();
    try {
      setLoadingAction(true);
      await onResolve(alert._id);
    } finally {
      setLoadingAction(false);
    }
  };

  const isVerifiedThreat = alert.threatStatus === 'verified_threat';
  const isUnverifiedAudio = alert.threatStatus === 'unverified_audio_trigger';

  // Dynamic border & glow based on threat type
  let borderStyle = '1px solid var(--border-subtle)';
  let bgGradient = 'var(--bg-secondary)';

  if (isVerifiedThreat) {
    borderStyle = '1px solid var(--threat-verified)';
    bgGradient = 'linear-gradient(180deg, rgba(239, 68, 68, 0.08) 0%, var(--bg-secondary) 100%)';
  } else if (isUnverifiedAudio) {
    borderStyle = '1px solid var(--threat-unverified-border)';
  }

  return (
    <div
      className="card"
      style={{
        border: borderStyle,
        background: bgGradient,
        marginBottom: '16px',
        position: 'relative'
      }}
    >
      {/* Top Meta Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ThreatBadge threatStatus={alert.threatStatus} emergencyType={alert.emergencyType} />
          <StatusBadge status={alert.status} />
          <span
            style={{
              fontSize: '0.75rem',
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              display: 'flex',
              alignItems: 'center',
              gap: '3px'
            }}
          >
            <Hash size={12} />
            SEQ #{alert.sequenceNumber}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          <Clock size={14} />
          <span>{new Date(alert.timestamp).toLocaleTimeString()} ({new Date(alert.timestamp).toLocaleDateString()})</span>
        </div>
      </div>

      {/* Main Alert Content Body */}
      <div style={{ display: 'grid', gridTemplateColumns: alert.imageUrl ? '1fr 140px' : '1fr', gap: '16px', alignItems: 'center' }}>
        <div>
          {/* Location Line */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '6px' }}>
            <MapPin size={18} color="#38bdf8" />
            <span>{alert.building} — {alert.room}</span>
            <span
              style={{
                fontSize: '0.78rem',
                backgroundColor: 'var(--bg-surface-active)',
                padding: '2px 8px',
                borderRadius: '4px',
                color: '#38bdf8',
                fontFamily: 'var(--font-mono)'
              }}
            >
              NODE {alert.nodeId}
            </span>
          </div>

          {/* CRITICAL REQUIREMENT: Plain statement when firearm was NOT verified */}
          {isUnverifiedAudio && (
            <div className="unverified-callout-box">
              <AlertTriangle size={20} color="#f97316" style={{ flexShrink: 0 }} />
              <div>
                <strong>Firearm was NOT verified:</strong> The MAX9814 acoustic CNN triggered on a suspected gunshot sound pattern, but laptop vision firearm detection verified negative (Confidence: {((alert.firearmConfidence || 0) * 100).toFixed(1)}%). Possible slam or non-firearm acoustic impulse.
              </div>
            </div>
          )}

          {/* Plain statement for verified threat */}
          {isVerifiedThreat && (
            <div
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: 'var(--radius-sm)',
                padding: '10px 14px',
                margin: '10px 0',
                color: '#fca5a5',
                fontSize: '0.88rem',
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
              }}
            >
              <ShieldAlert size={20} color="#ef4444" style={{ flexShrink: 0 }} />
              <div>
                <strong>HIGH THREAT VERIFIED:</strong> TinyML acoustic gunshot CNN triggered and security camera computer vision confirmed firearm with {((alert.firearmConfidence || 0) * 100).toFixed(1)}% confidence. Security response initiated.
              </div>
            </div>
          )}

          {/* Confidence and Telemetry Badges */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '10px', fontSize: '0.82rem', fontFamily: 'var(--font-mono)' }}>
            {alert.audioConfidence !== null && alert.audioConfidence !== undefined && (
              <div style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <Activity size={14} color="#f97316" />
                <span>Audio CNN: <strong>{((alert.audioConfidence) * 100).toFixed(1)}%</strong></span>
              </div>
            )}
            {alert.firearmConfidence !== null && alert.firearmConfidence !== undefined && (
              <div style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <Eye size={14} color={alert.firearmConfidence > 0.5 ? '#ef4444' : '#10b981'} />
                <span>Firearm Vision: <strong>{((alert.firearmConfidence) * 100).toFixed(1)}%</strong></span>
              </div>
            )}
            <div style={{ color: 'var(--text-muted)' }}>
              Checksum: <code>{alert.checksum?.slice(0, 8)}...</code>
            </div>
          </div>

          {/* Acknowledgement Metadata */}
          {alert.acknowledgedBy && (
            <div style={{ marginTop: '8px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Acknowledged by: <strong style={{ color: 'var(--text-secondary)' }}>{alert.acknowledgedBy}</strong>
              {alert.resolvedAt && (
                <span> • Resolved at {new Date(alert.resolvedAt).toLocaleTimeString()}</span>
              )}
            </div>
          )}
        </div>

        {/* Optional Webcam Frame Snapshot Thumbnail */}
        {alert.imageUrl && (
          <div
            style={{
              position: 'relative',
              borderRadius: 'var(--radius-sm)',
              overflow: 'hidden',
              cursor: 'pointer',
              border: '1px solid var(--border-subtle)',
              aspectRatio: '4 / 3'
            }}
            onClick={() => onSelectImage && onSelectImage(alert)}
            title="Click to inspect camera frame in detail"
          >
            <img
              src={alert.imageUrl}
              alt="Verification Snapshot"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={(e) => {
                e.target.src = '/uploads/alerts/placeholder_verified_gunshot.svg';
              }}
            />
            <div
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                background: 'rgba(0,0,0,0.7)',
                color: 'white',
                fontSize: '0.65rem',
                textAlign: 'center',
                padding: '2px',
                fontFamily: 'var(--font-mono)'
              }}
            >
              SNAP #{alert.sequenceNumber}
            </div>
          </div>
        )}
      </div>

      {/* Action Buttons Toolbar */}
      <div
        style={{
          marginTop: '16px',
          paddingTop: '12px',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '8px'
        }}
      >
        <div style={{ display: 'flex', gap: '8px' }}>
          <Link
            to={`/cam-view?nodeId=${alert.nodeId}`}
            className="btn btn-outline btn-sm"
          >
            <Eye size={14} />
            <span>Open Cam View</span>
          </Link>
          <Link
            to={`/map?nodeId=${alert.nodeId}`}
            className="btn btn-outline btn-sm"
          >
            <MapPin size={14} />
            <span>Locate on Map</span>
          </Link>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          {alert.status === 'new' && (
            <button
              className="btn btn-warning btn-sm"
              onClick={handleAck}
              disabled={loadingAction}
            >
              <Clock size={14} />
              <span>Acknowledge Alert</span>
            </button>
          )}

          {alert.status !== 'resolved' && (
            <button
              className="btn btn-primary btn-sm"
              onClick={handleResolve}
              disabled={loadingAction}
            >
              <CheckCircle size={14} />
              <span>Mark Resolved</span>
            </button>
          )}

          {alert.status === 'resolved' && (
            <span style={{ fontSize: '0.8rem', color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <ShieldCheck size={16} />
              Incident Cleared
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
