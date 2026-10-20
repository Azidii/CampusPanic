import React from 'react';
import { ShieldAlert, AlertTriangle, Flame, HeartPulse, BellRing, CheckCircle, Clock } from 'lucide-react';

export const ThreatBadge = ({ threatStatus, emergencyType }) => {
  if (threatStatus === 'verified_threat') {
    return (
      <span className="badge badge-verified-threat">
        <ShieldAlert size={13} />
        VERIFIED THREAT
      </span>
    );
  }

  if (threatStatus === 'unverified_audio_trigger') {
    return (
      <span className="badge badge-unverified-audio">
        <AlertTriangle size={13} />
        UNVERIFIED AUDIO TRIGGER
      </span>
    );
  }

  // Manual alerts
  switch (emergencyType) {
    case 'medical':
      return (
        <span className="badge badge-medical">
          <HeartPulse size={13} />
          MEDICAL EMERGENCY
        </span>
      );
    case 'fire':
      return (
        <span className="badge badge-fire">
          <Flame size={13} />
          FIRE ALARM
        </span>
      );
    case 'panic':
      return (
        <span className="badge badge-panic">
          <BellRing size={13} />
          MANUAL PANIC
        </span>
      );
    default:
      return (
        <span className="badge badge-unverified-audio">
          <AlertTriangle size={13} />
          MANUAL ALERT
        </span>
      );
  }
};

export const StatusBadge = ({ status }) => {
  switch (status) {
    case 'new':
      return (
        <span className="badge badge-status-new">
          <Clock size={12} />
          NEW
        </span>
      );
    case 'acknowledged':
      return (
        <span className="badge badge-status-ack">
          <Clock size={12} />
          ACKNOWLEDGED
        </span>
      );
    case 'resolved':
      return (
        <span className="badge badge-status-resolved">
          <CheckCircle size={12} />
          RESOLVED
        </span>
      );
    default:
      return <span className="badge">{status}</span>;
  }
};
