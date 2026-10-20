import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { useSettings } from '../../context/SettingsContext';
import { useAlerts } from '../../context/AlertContext';
import {
  ShieldAlert,
  Volume2,
  VolumeX,
  Sun,
  Moon,
  Radio,
  User,
  LogOut
} from 'lucide-react';
import { Link } from 'react-router-dom';

export const Navbar = () => {
  const { user, logout } = useAuth();
  const { isConnected } = useSocket();
  const { theme, toggleTheme, soundEnabled, toggleSound } = useSettings();
  const { counts } = useAlerts();

  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header className="top-nav">
      <div className="nav-left">
        {/* Real-time Socket Connection Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
          <span
            style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              backgroundColor: isConnected ? '#10b981' : '#ef4444',
              boxShadow: isConnected ? '0 0 8px #10b981' : '0 0 8px #ef4444'
            }}
          />
          <span style={{ color: isConnected ? '#10b981' : '#ef4444', fontWeight: 600 }}>
            {isConnected ? 'STATION LIVE' : 'STATION DISCONNECTED'}
          </span>
        </div>

        {/* Live Clock */}
        <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Radio size={14} />
          {currentTime.toLocaleTimeString()} UTC+8
        </div>
      </div>

      <div className="nav-right">
        {/* Active Threats Counter */}
        {counts.verifiedThreats > 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: 'rgba(239, 68, 68, 0.2)',
              border: '1px solid #ef4444',
              padding: '4px 12px',
              borderRadius: '9999px',
              color: '#f87171',
              fontWeight: 700,
              fontSize: '0.82rem',
              animation: 'blinkRec 1s infinite'
            }}
          >
            <ShieldAlert size={16} />
            <span>{counts.verifiedThreats} ACTIVE THREAT{counts.verifiedThreats > 1 ? 'S' : ''}</span>
          </div>
        )}

        {/* Sound Toggle */}
        <button
          className="btn btn-outline btn-sm"
          onClick={toggleSound}
          title={soundEnabled ? 'Alert siren enabled (Click to mute)' : 'Alert siren muted (Click to unmute)'}
          style={{
            borderColor: soundEnabled ? 'var(--border-subtle)' : '#f59e0b',
            color: soundEnabled ? 'var(--text-primary)' : '#f59e0b'
          }}
        >
          {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
          <span>{soundEnabled ? 'Audio On' : 'Muted'}</span>
        </button>

        {/* Theme Toggle */}
        <button
          className="btn btn-outline btn-sm"
          onClick={toggleTheme}
          title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        {/* User Profile Info */}
        {user && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Link
              to="/profile"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                textDecoration: 'none',
                color: 'var(--text-primary)',
                fontSize: '0.85rem'
              }}
            >
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--bg-surface-active)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px solid var(--border-subtle)'
                }}
              >
                <User size={16} />
              </div>
              <div>
                <div style={{ fontWeight: 600, lineHeight: 1.2 }}>{user.name}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                  {user.role} • {user.assignedBuilding || 'Security'}
                </div>
              </div>
            </Link>

            <button
              className="btn btn-outline btn-sm"
              onClick={logout}
              title="Sign Out"
              style={{ color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.3)' }}
            >
              <LogOut size={15} />
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
