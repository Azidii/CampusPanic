import React, { useState, useRef, useEffect } from 'react';
import { useSocket } from '../context/SocketContext';
import { api } from '../services/api';
import { Video, Camera, Radio, CheckCircle, AlertTriangle, Play, Square } from 'lucide-react';

export const BroadcasterPage = () => {
  const { socket, isConnected } = useSocket();

  const [cameras, setCameras] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState('CAM-SC101');
  const [isStreaming, setIsStreaming] = useState(false);
  const [fps, setFps] = useState(2); // 2 frames/sec default
  const [framesSent, setFramesSent] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    const loadCams = async () => {
      try {
        const res = await api.getCameras();
        if (res.success && res.cameras) {
          setCameras(res.cameras);
        }
      } catch (e) {
        // ignore
      }
    };
    loadCams();
  }, []);

  const startStream = async () => {
    setErrorMsg('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }

      setIsStreaming(true);
      setFramesSent(0);

      // Start snapshot transmission loop
      const intervalMs = Math.round(1000 / fps);
      intervalRef.current = setInterval(() => {
        captureAndTransmitFrame();
      }, intervalMs);

      // Mark camera online on backend
      await fetch(`/api/cameras/${selectedCameraId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('cp_token')}`
        },
        body: JSON.stringify({ online: true })
      }).catch(() => {});
    } catch (err) {
      setErrorMsg(`Webcam access denied or unavailable: ${err.message}`);
    }
  };

  const stopStream = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setIsStreaming(false);

    // Mark camera offline on backend
    fetch(`/api/cameras/${selectedCameraId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('cp_token')}`
      },
      body: JSON.stringify({ online: false })
    }).catch(() => {});
  };

  const captureAndTransmitFrame = () => {
    if (!videoRef.current || !canvasRef.current || !socket) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    if (video.videoWidth > 0 && video.videoHeight > 0) {
      canvas.width = 480;
      canvas.height = 360;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const frameData = canvas.toDataURL('image/jpeg', 0.6);

      // Broadcast real-time frame via Socket.IO
      socket.emit('camera:stream_frame', {
        cameraId: selectedCameraId,
        frameData,
        timestamp: Date.now()
      });

      setFramesSent((prev) => prev + 1);
    }
  };

  useEffect(() => {
    return () => {
      stopStream();
    };
  }, []);

  return (
    <div style={{ maxWidth: '850px', margin: '0 auto' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Video size={24} color="#ef4444" />
          Laptop & Mobile Webcam Broadcaster Gateway
        </h1>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }}>
          Turn this browser device into a live campus security camera channel streaming frames via Socket.IO to the central station.
        </p>
      </div>

      {errorMsg && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 'var(--radius-sm)',
            marginBottom: '20px',
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid #ef4444',
            color: '#f87171',
            fontSize: '0.88rem'
          }}
        >
          {errorMsg}
        </div>
      )}

      <div className="card" style={{ marginBottom: '24px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Broadcast as Channel:</label>
            <select
              className="form-select"
              value={selectedCameraId}
              onChange={(e) => setSelectedCameraId(e.target.value)}
              disabled={isStreaming}
            >
              {cameras.map((c) => (
                <option key={c._id} value={c.cameraId}>
                  {c.cameraId} — {c.label} ({c.room})
                </option>
              ))}
            </select>
          </div>

          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Transmission Rate:</label>
            <select
              className="form-select"
              value={fps}
              onChange={(e) => setFps(parseInt(e.target.value, 10))}
              disabled={isStreaming}
            >
              <option value="1">1 Frame / Second (Low Bandwidth)</option>
              <option value="2">2 Frames / Second (Standard Surveillance)</option>
              <option value="5">5 Frames / Second (High Cadence)</option>
            </select>
          </div>
        </div>

        {/* Video Viewport */}
        <div
          style={{
            aspectRatio: '16/9',
            background: '#070a14',
            borderRadius: 'var(--radius-sm)',
            overflow: 'hidden',
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '20px'
          }}
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: isStreaming ? 'block' : 'none'
            }}
          />

          {!isStreaming && (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
              <Camera size={48} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
              <div style={{ fontSize: '0.95rem', fontWeight: 600 }}>Webcam Stream Inactive</div>
              <p style={{ fontSize: '0.82rem', maxWidth: '360px', margin: '4px auto 0' }}>
                Click "Start Broadcasting" to request webcam access and stream live frames to the CCTV matrix.
              </p>
            </div>
          )}

          {isStreaming && (
            <div
              style={{
                position: 'absolute',
                top: '12px',
                left: '12px',
                background: 'rgba(0,0,0,0.7)',
                padding: '4px 10px',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.78rem',
                color: '#ef4444'
              }}
            >
              <span className="rec-dot" />
              <span>BROADCASTING LIVE ({selectedCameraId})</span>
            </div>
          )}
        </div>

        {/* Hidden Canvas for JPEG snapshot rendering */}
        <canvas ref={canvasRef} style={{ display: 'none' }} />

        {/* Controls */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            {!isStreaming ? (
              <button className="btn btn-primary" onClick={startStream}>
                <Play size={16} />
                <span>Start Broadcasting</span>
              </button>
            ) : (
              <button className="btn btn-danger" onClick={stopStream}>
                <Square size={16} />
                <span>Stop Broadcasting</span>
              </button>
            )}
          </div>

          <div style={{ fontSize: '0.82rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
            Frames Transmitted: <strong style={{ color: '#38bdf8' }}>{framesSent}</strong>
          </div>
        </div>
      </div>
    </div>
  );
};
