import React, { useState, useEffect } from 'react';
import { useSocket } from '../../context/SocketContext';
import { Camera, Radio, Maximize2, VideoOff } from 'lucide-react';

export const CameraCard = ({ camera, onEnlarge }) => {
  const { socket } = useSocket();
  const [liveFrame, setLiveFrame] = useState(camera.lastFrameUrl);
  const [lastUpdated, setLastUpdated] = useState(camera.lastFrameAt);
  const [isOnline, setIsOnline] = useState(camera.online);

  useEffect(() => {
    if (!socket) return;

    // Listen for live frames for this specific camera
    const handleLiveFrame = (data) => {
      if (data.cameraId === camera.cameraId) {
        setLiveFrame(data.frameData || data.frameUrl);
        setLastUpdated(data.timestamp || new Date());
        setIsOnline(true);
      }
    };

    const handleCameraStatus = (data) => {
      if (data.cameraId === camera.cameraId) {
        setIsOnline(data.online);
      }
    };

    socket.on('camera:live_frame', handleLiveFrame);
    socket.on('camera:frame', handleLiveFrame);
    socket.on('camera:status', handleCameraStatus);

    return () => {
      socket.off('camera:live_frame', handleLiveFrame);
      socket.off('camera:frame', handleLiveFrame);
      socket.off('camera:status', handleCameraStatus);
    };
  }, [socket, camera.cameraId]);

  return (
    <div className="camera-card" onClick={() => onEnlarge && onEnlarge(camera, liveFrame)}>
      <div className="camera-viewport">
        {isOnline && liveFrame ? (
          <img
            src={liveFrame}
            alt={camera.label}
            onError={(e) => {
              e.target.src = '/uploads/alerts/placeholder_verified_gunshot.svg';
            }}
          />
        ) : (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
            <VideoOff size={36} style={{ margin: '0 auto 8px', opacity: 0.5 }} />
            <div style={{ fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>FEED OFFLINE</div>
          </div>
        )}

        {/* Top Overlay Bar */}
        <div className="camera-header-overlay">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {isOnline ? (
              <span className="live-rec-indicator">
                <span className="rec-dot" />
                <span>LIVE</span>
              </span>
            ) : (
              <span style={{ color: '#94a3b8' }}>OFFLINE</span>
            )}
            <span style={{ color: '#38bdf8' }}>{camera.cameraId}</span>
          </div>

          <div style={{ color: '#94a3b8', fontSize: '0.7rem' }}>
            {lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : 'No Signal'}
          </div>
        </div>

        {/* Hover Enlarge Icon */}
        <div
          style={{
            position: 'absolute',
            bottom: '10px',
            right: '10px',
            background: 'rgba(0,0,0,0.6)',
            padding: '6px',
            borderRadius: '4px',
            color: 'white'
          }}
        >
          <Maximize2 size={14} />
        </div>
      </div>

      {/* Card Info Footer */}
      <div style={{ padding: '12px 14px', background: 'var(--bg-secondary)', borderTop: '1px solid var(--border-subtle)' }}>
        <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)', marginBottom: '2px' }}>
          {camera.label}
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          {camera.building} — {camera.room} {camera.nodeId ? `(Node ${camera.nodeId})` : ''}
        </div>
      </div>
    </div>
  );
};
