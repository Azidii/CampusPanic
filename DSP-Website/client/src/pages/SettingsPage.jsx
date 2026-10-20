import React, { useState } from 'react';
import { useSettings } from '../context/SettingsContext';
import { playVerifiedThreatAlarm, playWarningChime } from '../services/sound';
import {
  Settings,
  Volume2,
  VolumeX,
  Sun,
  Moon,
  MapPin,
  Bell,
  Shield,
  Save,
  CheckCircle2
} from 'lucide-react';

export const SettingsPage = () => {
  const {
    theme,
    toggleTheme,
    soundEnabled,
    toggleSound,
    volume,
    setVolume,
    campusCenter,
    updateCampusCenter
  } = useSettings();

  const [lat, setLat] = useState(campusCenter.lat);
  const [lng, setLng] = useState(campusCenter.lng);
  const [mapSaved, setMapSaved] = useState(false);

  // Notification Preferences
  const [desktopNotifs, setDesktopNotifs] = useState(false);
  const [autoAckAudio, setAutoAckAudio] = useState(false);

  const handleSaveMapCoords = (e) => {
    e.preventDefault();
    updateCampusCenter({ lat: parseFloat(lat), lng: parseFloat(lng), zoom: 17 });
    setMapSaved(true);
    setTimeout(() => setMapSaved(false), 3000);
  };

  const handleTestSiren = () => {
    playVerifiedThreatAlarm(volume);
  };

  const handleTestChime = () => {
    playWarningChime(volume);
  };

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Settings size={24} color="#38bdf8" />
          Station Console Configuration & Preferences
        </h1>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }}>
          Customize auditory sirens, visual contrast themes, geospatial map anchors, and privacy policies.
        </p>
      </div>

      <div style={{ display: 'grid', gap: '24px' }}>
        {/* 1. Theme and Display Aesthetics */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              {theme === 'dark' ? <Moon size={18} color="#38bdf8" /> : <Sun size={18} color="#f59e0b" />}
              Display Theme & Console Appearance
            </h3>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' }}>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Interface Theme Mode</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                Switch between High-Contrast Dark Security Console and Daytime Light Mode.
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                className={`btn btn-sm ${theme === 'dark' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => theme !== 'dark' && toggleTheme()}
              >
                <Moon size={14} /> Dark Mode
              </button>
              <button
                className={`btn btn-sm ${theme === 'light' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => theme !== 'light' && toggleTheme()}
              >
                <Sun size={14} /> Light Mode
              </button>
            </div>
          </div>
        </div>

        {/* 2. Auditory Alarm System */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <Volume2 size={18} color="#ef4444" />
              Emergency Auditory Alarms & Sirens
            </h3>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Threat Alarm Siren</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                Plays a dual-tone emergency siren automatically upon receiving a verified gunshot threat.
              </div>
            </div>

            <button
              className={`btn btn-sm ${soundEnabled ? 'btn-primary' : 'btn-outline'}`}
              onClick={toggleSound}
              style={{ minWidth: '120px' }}
            >
              {soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
              <span>{soundEnabled ? 'Sound Active' : 'Sound Muted'}</span>
            </button>
          </div>

          <div style={{ padding: '16px 0', borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Alarm Master Volume</span>
              <span style={{ fontSize: '0.85rem', fontFamily: 'var(--font-mono)', color: '#38bdf8' }}>{Math.round(volume * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.1"
              max="1.0"
              step="0.05"
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              style={{ width: '100%', cursor: 'pointer' }}
            />
          </div>

          <div style={{ paddingTop: '16px', display: 'flex', gap: '10px' }}>
            <button className="btn btn-outline btn-sm" onClick={handleTestSiren} disabled={!soundEnabled}>
              <Volume2 size={14} color="#ef4444" />
              <span>Test Verified Threat Siren</span>
            </button>
            <button className="btn btn-outline btn-sm" onClick={handleTestChime} disabled={!soundEnabled}>
              <Volume2 size={14} color="#f59e0b" />
              <span>Test Warning Chime</span>
            </button>
          </div>
        </div>

        {/* 3. Campus Map Geo-Coordinates */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <MapPin size={18} color="#10b981" />
              Campus Map Center Geospatial Anchor
            </h3>
          </div>

          <form onSubmit={handleSaveMapCoords}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label">Campus Center Latitude</label>
                <input
                  type="number"
                  step="0.00001"
                  className="form-input"
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Campus Center Longitude</label>
                <input
                  type="number"
                  step="0.00001"
                  className="form-input"
                  value={lng}
                  onChange={(e) => setLng(e.target.value)}
                  required
                />
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '6px' }}>
              <button type="submit" className="btn btn-primary btn-sm">
                <Save size={14} />
                <span>Save Geospatial Coordinates</span>
              </button>
              {mapSaved && (
                <span style={{ fontSize: '0.82rem', color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <CheckCircle2 size={15} /> Coordinates updated!
                </span>
              )}
            </div>
          </form>
        </div>

        {/* 4. Privacy & Data Protection Compliance */}
        <div className="card" style={{ background: 'var(--bg-surface)' }}>
          <div className="card-header">
            <h3 className="card-title">
              <Shield size={18} color="#38bdf8" />
              Data Privacy Act Compliance & Image Retention
            </h3>
          </div>

          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            <p style={{ marginBottom: '8px' }}>
              In accordance with the Data Privacy Act compliance architecture of the CampusPanic platform:
            </p>
            <ul style={{ paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <li>
                <strong>No Continuous Surveillance Recording:</strong> Camera streams are monitored live in real-time memory and are never written continuously to disk.
              </li>
              <li>
                <strong>Incident Trigger Storage Only:</strong> Visual snapshots are captured exclusively when an acoustic gunshot event or manual panic trigger occurs.
              </li>
              <li>
                <strong>Automated Retention Purge:</strong> All incident snapshot frames are automatically deleted from server disk after the configured retention period (default: 24 hours).
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
