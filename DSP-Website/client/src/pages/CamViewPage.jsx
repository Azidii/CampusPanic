import React, { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api } from '../services/api';
import { useSocket } from '../context/SocketContext';
import { useAlerts } from '../context/AlertContext';
import { ThreatBadge, StatusBadge } from '../components/common/Badge';
import {
  Camera,
  ShieldAlert,
  AlertTriangle,
  Eye,
  CheckCircle,
  Clock,
  Radio,
  MapPin,
  Maximize2,
  RefreshCw,
  VideoOff
} from 'lucide-react';

export const CamViewPage = () => {
  const [searchParams] = useSearchParams();
  const queryNodeId = searchParams.get('nodeId');

  const { socket } = useSocket();
  const { alerts, acknowledgeAlert, resolveAlert } = useAlerts();

  const [nodes, setNodes] = useState([]);
  const [cameras, setCameras] = useState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(queryNodeId || 'SC-101');
  const [liveStreamFrame, setLiveStreamFrame] = useState(null);
  const [liveStreamTime, setLiveStreamTime] = useState(null);

  // Load nodes and camera metadata
  useEffect(() => {
    const loadData = async () => {
      try {
        const [nodesRes, camsRes] = await Promise.all([
          api.getNodes(),
          api.getCameras()
        ]);
        if (nodesRes.success && nodesRes.nodes) {
          setNodes(nodesRes.nodes);
          if (!queryNodeId && nodesRes.nodes.length > 0) {
            setSelectedNodeId(nodesRes.nodes[0].nodeId);
          }
        }
        if (camsRes.success && camsRes.cameras) {
          setCameras(camsRes.cameras);
        }
      } catch (err) {
        console.error('[CamView] Error loading data:', err);
      }
    };
    loadData();
  }, [queryNodeId]);

  // Current selected node
  const currentNode = nodes.find((n) => n.nodeId === selectedNodeId) || nodes[0];
  // Associated camera
  const currentCamera = cameras.find((c) => c.nodeId === selectedNodeId || c.cameraId === currentNode?.cameraId);
  // Most recent alert for this node
  const currentAlert = alerts.find((a) => a.nodeId === selectedNodeId);

  // Realtime camera frames listener
  useEffect(() => {
    if (!socket || !currentCamera) return;

    const handleFrame = (data) => {
      if (data.cameraId === currentCamera.cameraId) {
        setLiveStreamFrame(data.frameData || data.frameUrl);
        setLiveStreamTime(data.timestamp || new Date());
      }
    };

    socket.on('camera:live_frame', handleFrame);
    socket.on('camera:frame', handleFrame);

    return () => {
      socket.off('camera:live_frame', handleFrame);
      socket.off('camera:frame', handleFrame);
    };
  }, [socket, currentCamera]);

  return (
    <div>
      {/* Page Header and Node Selector */}
      <div
        className="card"
        style={{
          padding: '16px 20px',
          marginBottom: '24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '16px'
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Camera size={22} color="#38bdf8" />
            Verification Cam View
          </h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Dual-feed verification station: Inspect triggering frame snapshots and real-time room video telemetry.
          </p>
        </div>

        {/* Node Selector Dropdown */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
            Active Room Node:
          </label>
          <select
            className="form-select"
            value={selectedNodeId}
            onChange={(e) => setSelectedNodeId(e.target.value)}
            style={{ width: 'auto', minWidth: '220px', fontWeight: 600 }}
          >
            {nodes.map((node) => (
              <option key={node._id} value={node.nodeId}>
                {node.nodeId} — {node.building} {node.room} ({node.status})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Prominent Verification Status Callout Banner */}
      {currentAlert ? (
        <div
          style={{
            padding: '18px 24px',
            borderRadius: 'var(--radius-md)',
            marginBottom: '24px',
            background:
              currentAlert.threatStatus === 'verified_threat'
                ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.25) 0%, rgba(185, 28, 28, 0.15) 100%)'
                : currentAlert.threatStatus === 'unverified_audio_trigger'
                ? 'linear-gradient(135deg, rgba(249, 115, 22, 0.25) 0%, rgba(194, 65, 12, 0.15) 100%)'
                : 'linear-gradient(135deg, rgba(59, 130, 246, 0.25) 0%, rgba(29, 78, 216, 0.15) 100%)',
            border:
              currentAlert.threatStatus === 'verified_threat'
                ? '2px solid #ef4444'
                : currentAlert.threatStatus === 'unverified_audio_trigger'
                ? '2px solid #f97316'
                : '2px solid #3b82f6',
            boxShadow:
              currentAlert.threatStatus === 'verified_threat'
                ? 'var(--shadow-glow-red)'
                : 'none'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
              {currentAlert.threatStatus === 'verified_threat' ? (
                <ShieldAlert size={34} color="#ef4444" style={{ flexShrink: 0 }} />
              ) : currentAlert.threatStatus === 'unverified_audio_trigger' ? (
                <AlertTriangle size={34} color="#f97316" style={{ flexShrink: 0 }} />
              ) : (
                <Radio size={34} color="#3b82f6" style={{ flexShrink: 0 }} />
              )}

              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#f8fafc' }}>
                    {currentAlert.threatStatus === 'verified_threat'
                      ? 'CRITICAL THREAT: FIREARM CONFIRMED BY VISION CLASSIFIER'
                      : currentAlert.threatStatus === 'unverified_audio_trigger'
                      ? 'FIREARM WAS NOT VERIFIED — UNVERIFIED AUDIO TRIGGER'
                      : `MANUAL EMERGENCY ALERT: ${currentAlert.emergencyType.toUpperCase()}`}
                  </h3>
                  <StatusBadge status={currentAlert.status} />
                </div>

                <p style={{ fontSize: '0.9rem', color: '#e2e8f0', lineHeight: 1.4 }}>
                  {currentAlert.threatStatus === 'unverified_audio_trigger' ? (
                    <span>
                      <strong>Plain Verification Statement:</strong> The MAX9814 TinyML audio CNN detected sound characteristics similar to a firearm, but the webcam visual detector analyzed the frame and <strong>verified negative (No firearm detected)</strong>. Possible non-firearm acoustic event (door slam, book drop, or construction noise).
                    </span>
                  ) : currentAlert.threatStatus === 'verified_threat' ? (
                    <span>
                      <strong>Vision Confirmation:</strong> Laptop camera computer vision model flagged a visible firearm with {((currentAlert.firearmConfidence || 0) * 100).toFixed(1)}% confidence score following acoustic CNN activation. Tactical campus lockdown protocol active.
                    </span>
                  ) : (
                    <span>
                      Manual three-button emergency panel was activated in room {currentAlert.room}. Automated snapshot frame recorded.
                    </span>
                  )}
                </p>
              </div>
            </div>

            {/* Quick Actions */}
            <div style={{ display: 'flex', gap: '10px' }}>
              {currentAlert.status === 'new' && (
                <button className="btn btn-warning btn-sm" onClick={() => acknowledgeAlert(currentAlert._id)}>
                  <Clock size={14} /> Acknowledge
                </button>
              )}
              {currentAlert.status !== 'resolved' && (
                <button className="btn btn-primary btn-sm" onClick={() => resolveAlert(currentAlert._id)}>
                  <CheckCircle size={14} /> Mark Resolved
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: '16px 20px', marginBottom: '24px', background: 'rgba(16, 185, 129, 0.08)', borderColor: 'rgba(16, 185, 129, 0.3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#34d399' }}>
            <CheckCircle size={20} />
            <span style={{ fontWeight: 600 }}>Normal Monitoring: No active emergency alerts currently recorded for this room node.</span>
          </div>
        </div>
      )}

      {/* Dual Video Frame Viewports (Captured Trigger Snapshot vs Realtime Stream) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '24px', marginBottom: '24px' }}>
        {/* Viewport 1: Captured Incident Snapshot */}
        <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Eye size={16} color="#ef4444" />
              <span>Trigger Snapshot (Vision Analyzed Frame)</span>
            </div>
            {currentAlert && (
              <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                SEQ #{currentAlert.sequenceNumber}
              </span>
            )}
          </div>

          <div style={{ aspectRatio: '16/9', background: '#070a12', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
            {currentAlert?.imageUrl ? (
              <img
                src={currentAlert.imageUrl}
                alt="Captured alert frame"
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                onError={(e) => {
                  e.target.src = '/uploads/alerts/placeholder_verified_gunshot.svg';
                }}
              />
            ) : currentCamera?.lastFrameUrl ? (
              <img
                src={currentCamera.lastFrameUrl}
                alt="Last recorded frame"
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            ) : (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                <VideoOff size={42} style={{ margin: '0 auto 8px', opacity: 0.4 }} />
                <div style={{ fontSize: '0.85rem' }}>No snapshot image attached to this alert</div>
              </div>
            )}
          </div>

          <div style={{ padding: '14px 18px', background: 'var(--bg-secondary)', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            Captured at: <strong>{currentAlert ? new Date(currentAlert.timestamp).toLocaleString() : 'N/A'}</strong>
          </div>
        </div>

        {/* Viewport 2: Live Room Camera Stream */}
        <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="live-rec-indicator">
                <span className="rec-dot" />
                <span>LIVE</span>
              </span>
              <span>{currentCamera?.label || `Room ${currentNode?.room} Camera Feed`}</span>
            </div>
            <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: '#38bdf8' }}>
              {currentCamera?.cameraId || 'CAM-NODE'}
            </span>
          </div>

          <div style={{ aspectRatio: '16/9', background: '#070a12', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
            {liveStreamFrame ? (
              <img
                src={liveStreamFrame}
                alt="Live Camera Stream"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : currentCamera?.lastFrameUrl ? (
              <img
                src={currentCamera.lastFrameUrl}
                alt="Recent snapshot"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                <VideoOff size={42} style={{ margin: '0 auto 8px', opacity: 0.4 }} />
                <div style={{ fontSize: '0.85rem' }}>Camera Stream Currently Idle / Offline</div>
                <div style={{ fontSize: '0.75rem', marginTop: '6px' }}>
                  Use the <Link to="/streamer" style={{ color: '#38bdf8' }}>Webcam Gateway</Link> to stream your laptop camera live!
                </div>
              </div>
            )}
          </div>

          <div style={{ padding: '14px 18px', background: 'var(--bg-secondary)', fontSize: '0.82rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
            <span>Stream Status: <strong style={{ color: '#10b981' }}>Connected (Socket.IO Realtime)</strong></span>
            <span>{liveStreamTime ? new Date(liveStreamTime).toLocaleTimeString() : 'Awaiting Frame'}</span>
          </div>
        </div>
      </div>

      {/* Telemetry and Sensor Diagnostic Grid */}
      <div className="card">
        <h3 className="card-title" style={{ marginBottom: '16px' }}>
          <Radio size={18} color="#38bdf8" />
          Hardware Node & Sensor Diagnostics
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
          <div style={{ padding: '14px', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Node Hardware ID</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
              {currentNode?.nodeId}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>ESP32 Wi-Fi + BLE Microcontroller</div>
          </div>

          <div style={{ padding: '14px', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Physical Room Location</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {currentNode?.building} — {currentNode?.room}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              GPS: {currentNode?.lat?.toFixed(5)}, {currentNode?.lng?.toFixed(5)}
            </div>
          </div>

          <div style={{ padding: '14px', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>MAX9814 Acoustic CNN</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f97316' }}>
              {currentAlert?.audioConfidence !== null && currentAlert?.audioConfidence !== undefined
                ? `${((currentAlert.audioConfidence) * 100).toFixed(1)}% Confidence`
                : 'Standby / Nominal'}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>On-device TinyML acoustic classification</div>
          </div>

          <div style={{ padding: '14px', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Firearm Computer Vision</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: currentAlert?.firearmConfidence > 0.5 ? '#ef4444' : '#10b981' }}>
              {currentAlert?.firearmConfidence !== null && currentAlert?.firearmConfidence !== undefined
                ? `${((currentAlert.firearmConfidence) * 100).toFixed(1)}% Match`
                : 'Camera Disarmed'}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              {currentAlert?.threatStatus === 'unverified_audio_trigger' ? 'Firearm NOT verified' : 'Gateway Vision Model'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
