import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useAlerts } from '../../context/AlertContext';
import {
  ShieldAlert,
  LayoutDashboard,
  Camera,
  Grid,
  MapPin,
  Flame,
  Users,
  Settings,
  User,
  LogOut,
  Video
} from 'lucide-react';

export const Sidebar = () => {
  const { user, isAdmin, logout } = useAuth();
  const { counts } = useAlerts();

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <NavLink to="/" className="brand-badge">
          <div className="brand-icon">
            <ShieldAlert size={20} />
          </div>
          <div>
            <div style={{ lineHeight: 1.1, fontSize: '1.05rem', color: '#f8fafc' }}>CampusPanic</div>
            <div style={{ fontSize: '0.68rem', color: '#94a3b8', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Operations Center
            </div>
          </div>
        </NavLink>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-group-title">Monitoring</div>

        <NavLink to="/" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <LayoutDashboard size={18} />
          <span>Dashboard</span>
          {counts.totalActive > 0 && (
            <span className="badge-count">{counts.totalActive}</span>
          )}
        </NavLink>

        <NavLink to="/cam-view" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <Camera size={18} />
          <span>Cam View</span>
        </NavLink>

        <NavLink to="/cameras" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <Grid size={18} />
          <span>All Cams (CCTV)</span>
        </NavLink>

        <div className="nav-group-title">Campus Telemetry</div>

        <NavLink to="/map" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <MapPin size={18} />
          <span>Map View</span>
        </NavLink>

        <NavLink to="/active-nodes-map" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <Flame size={18} />
          <span>Active Nodes Map</span>
        </NavLink>

        <NavLink to="/streamer" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <Video size={18} />
          <span>Webcam Gateway</span>
        </NavLink>

        {/* Admin Only Section */}
        {isAdmin && (
          <>
            <div className="nav-group-title">Administration</div>
            <NavLink to="/admin/users" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Users size={18} />
              <span>User Management</span>
            </NavLink>
          </>
        )}

        <div className="nav-group-title">Preferences</div>

        <NavLink to="/profile" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <User size={18} />
          <span>Profile</span>
        </NavLink>

        <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <Settings size={18} />
          <span>Settings</span>
        </NavLink>
      </nav>

      <div className="sidebar-footer">
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          <div>Logged in as:</div>
          <strong style={{ color: 'var(--text-primary)' }}>{user?.email}</strong>
        </div>
        <button
          onClick={logout}
          className="btn btn-outline btn-sm"
          title="Sign out"
          style={{ padding: '6px', color: '#ef4444' }}
        >
          <LogOut size={16} />
        </button>
      </div>
    </aside>
  );
};
