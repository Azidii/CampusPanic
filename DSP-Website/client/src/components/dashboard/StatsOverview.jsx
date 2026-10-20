import React, { useEffect, useState } from 'react';
import { useAlerts } from '../../context/AlertContext';
import { api } from '../../services/api';
import { useSocket } from '../../context/SocketContext';
import {
  ShieldAlert,
  Volume2,
  HeartPulse,
  Flame,
  BellRing,
  Cpu
} from 'lucide-react';

export const StatsOverview = () => {
  const { counts } = useAlerts();
  const { socket } = useSocket();
  const [nodeStats, setNodeStats] = useState({ online: 0, total: 0 });

  const fetchNodeStats = async () => {
    try {
      const res = await api.getNodes();
      if (res.success && res.nodes) {
        const onlineCount = res.nodes.filter((n) => n.status !== 'offline').length;
        setNodeStats({ online: onlineCount, total: res.nodes.length });
      }
    } catch (e) {
      // ignore
    }
  };

  useEffect(() => {
    fetchNodeStats();
  }, []);

  useEffect(() => {
    if (!socket) return;
    const handleNodeChange = () => fetchNodeStats();
    socket.on('node:updated', handleNodeChange);
    socket.on('node:created', handleNodeChange);
    socket.on('node:deleted', handleNodeChange);
    return () => {
      socket.off('node:updated', handleNodeChange);
      socket.off('node:created', handleNodeChange);
      socket.off('node:deleted', handleNodeChange);
    };
  }, [socket]);

  return (
    <div className="stats-grid">
      {/* 1. Verified Threats */}
      <div
        className="stat-card"
        style={{
          borderColor: counts.verifiedThreats > 0 ? '#ef4444' : 'var(--border-subtle)',
          boxShadow: counts.verifiedThreats > 0 ? 'var(--shadow-glow-red)' : 'none'
        }}
      >
        <div
          className="stat-icon-wrap"
          style={{
            backgroundColor: 'var(--threat-verified-bg)',
            color: 'var(--threat-verified)'
          }}
        >
          <ShieldAlert size={26} />
        </div>
        <div className="stat-info">
          <div className="stat-value" style={{ color: counts.verifiedThreats > 0 ? '#ef4444' : 'inherit' }}>
            {counts.verifiedThreats}
          </div>
          <div className="stat-label">Verified Threats</div>
        </div>
      </div>

      {/* 2. Gunshot Audio Events */}
      <div className="stat-card">
        <div
          className="stat-icon-wrap"
          style={{
            backgroundColor: 'var(--threat-unverified-bg)',
            color: 'var(--threat-unverified)'
          }}
        >
          <Volume2 size={26} />
        </div>
        <div className="stat-info">
          <div className="stat-value">{counts.gunshot || 0}</div>
          <div className="stat-label">Gunshot Audio Triggers</div>
        </div>
      </div>

      {/* 3. Medical Alerts */}
      <div className="stat-card">
        <div
          className="stat-icon-wrap"
          style={{
            backgroundColor: 'var(--type-medical-bg)',
            color: 'var(--type-medical)'
          }}
        >
          <HeartPulse size={26} />
        </div>
        <div className="stat-info">
          <div className="stat-value">{counts.medical || 0}</div>
          <div className="stat-label">Medical Emergencies</div>
        </div>
      </div>

      {/* 4. Fire Alarms */}
      <div className="stat-card">
        <div
          className="stat-icon-wrap"
          style={{
            backgroundColor: 'var(--type-fire-bg)',
            color: 'var(--type-fire)'
          }}
        >
          <Flame size={26} />
        </div>
        <div className="stat-info">
          <div className="stat-value">{counts.fire || 0}</div>
          <div className="stat-label">Fire Alarms</div>
        </div>
      </div>

      {/* 5. Manual Panic Triggers */}
      <div className="stat-card">
        <div
          className="stat-icon-wrap"
          style={{
            backgroundColor: 'var(--type-panic-bg)',
            color: 'var(--type-panic)'
          }}
        >
          <BellRing size={26} />
        </div>
        <div className="stat-info">
          <div className="stat-value">{counts.panic || 0}</div>
          <div className="stat-label">Panic Button Press</div>
        </div>
      </div>

      {/* 6. Nodes Online */}
      <div className="stat-card">
        <div
          className="stat-icon-wrap"
          style={{
            backgroundColor: 'rgba(16, 185, 129, 0.12)',
            color: '#10b981'
          }}
        >
          <Cpu size={26} />
        </div>
        <div className="stat-info">
          <div className="stat-value" style={{ fontSize: '1.5rem' }}>
            {nodeStats.online} / {nodeStats.total}
          </div>
          <div className="stat-label">Room Nodes Online</div>
        </div>
      </div>
    </div>
  );
};
