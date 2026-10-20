import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { CameraCard } from '../components/camera/CameraCard';
import { Modal } from '../components/common/Modal';
import { Grid, Filter, RefreshCw, Video, Radio, Eye } from 'lucide-react';
import { Link } from 'react-router-dom';

export const AllCamsPage = () => {
  const [cameras, setCameras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [buildingFilter, setBuildingFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // Enlarge Modal State
  const [enlargedCamera, setEnlargedCamera] = useState(null);
  const [enlargedFrame, setEnlargedFrame] = useState(null);

  const fetchCameras = async () => {
    try {
      setLoading(true);
      const res = await api.getCameras();
      if (res.success && res.cameras) {
        setCameras(res.cameras);
      }
    } catch (err) {
      console.error('[AllCams] Failed to fetch cameras:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCameras();
  }, []);

  const handleEnlarge = (camera, currentFrame) => {
    setEnlargedCamera(camera);
    setEnlargedFrame(currentFrame);
  };

  const filteredCameras = cameras.filter((cam) => {
    const matchesBuilding = buildingFilter === 'all' || cam.building === buildingFilter;
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'online' && cam.online) ||
      (statusFilter === 'offline' && !cam.online);
    return matchesBuilding && matchesStatus;
  });

  return (
    <div>
      {/* Header Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Grid size={24} color="#38bdf8" />
            CCTV Main Server Video Matrix
          </h1>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }}>
            Synchronized live surveillance feeds from laptop webcams, phone gateways, and room sensors.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <Link to="/streamer" className="btn btn-primary btn-sm">
            <Video size={16} />
            <span>Launch Webcam Broadcaster</span>
          </Link>
          <button className="btn btn-outline btn-sm" onClick={fetchCameras} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div
        className="card"
        style={{
          padding: '14px 18px',
          marginBottom: '24px',
          display: 'flex',
          alignItems: 'center',
          gap: '14px',
          flexWrap: 'wrap'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          <Filter size={16} />
          <span>Filters:</span>
        </div>

        <select
          className="form-select"
          style={{ width: 'auto', fontSize: '0.84rem' }}
          value={buildingFilter}
          onChange={(e) => setBuildingFilter(e.target.value)}
        >
          <option value="all">All Campus Buildings</option>
          <option value="Science Complex">Science Complex</option>
          <option value="Engineering Hall">Engineering Hall</option>
        </select>

        <select
          className="form-select"
          style={{ width: 'auto', fontSize: '0.84rem' }}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">All Camera Statuses</option>
          <option value="online">Online Channels Only</option>
          <option value="offline">Offline Channels</option>
        </select>

        <div style={{ marginLeft: 'auto', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          Showing <strong>{filteredCameras.length}</strong> of {cameras.length} camera feeds
        </div>
      </div>

      {/* CCTV Camera Matrix Grid */}
      {loading && cameras.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '60px', color: 'var(--text-muted)' }}>
          <RefreshCw size={32} className="animate-spin" style={{ margin: '0 auto 12px' }} />
          <div>Connecting to campus camera feeds...</div>
        </div>
      ) : filteredCameras.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
          <Video size={40} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
          <h4>No Camera Feeds Match Criteria</h4>
        </div>
      ) : (
        <div className="cctv-grid">
          {filteredCameras.map((camera) => (
            <CameraCard
              key={camera._id}
              camera={camera}
              onEnlarge={handleEnlarge}
            />
          ))}
        </div>
      )}

      {/* Enlarged CCTV Channel Modal */}
      {enlargedCamera && (
        <Modal
          isOpen={Boolean(enlargedCamera)}
          onClose={() => setEnlargedCamera(null)}
          title={`CCTV Channel: ${enlargedCamera.label} (${enlargedCamera.cameraId})`}
          maxWidth="900px"
          footer={
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                Location: {enlargedCamera.building} — {enlargedCamera.room} {enlargedCamera.nodeId ? `(Node ${enlargedCamera.nodeId})` : ''}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {enlargedCamera.nodeId && (
                  <Link
                    to={`/cam-view?nodeId=${enlargedCamera.nodeId}`}
                    className="btn btn-outline btn-sm"
                  >
                    <Eye size={14} /> Open Verification View
                  </Link>
                )}
                <button className="btn btn-primary btn-sm" onClick={() => setEnlargedCamera(null)}>
                  Close
                </button>
              </div>
            </div>
          }
        >
          <div style={{ aspectRatio: '16/9', background: '#05070c', borderRadius: 'var(--radius-sm)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <img
              src={enlargedFrame || enlargedCamera.lastFrameUrl || '/uploads/alerts/placeholder_verified_gunshot.svg'}
              alt={enlargedCamera.label}
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              onError={(e) => {
                e.target.src = '/uploads/alerts/placeholder_verified_gunshot.svg';
              }}
            />
          </div>
        </Modal>
      )}
    </div>
  );
};
