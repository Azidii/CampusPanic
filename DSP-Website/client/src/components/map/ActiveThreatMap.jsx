import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, ImageOverlay } from 'react-leaflet';
import L from 'leaflet';
import { useSettings } from '../../context/SettingsContext';
import { api } from '../../services/api';
import { useSocket } from '../../context/SocketContext';
import { useAlerts } from '../../context/AlertContext';
import { ThreatBadge } from '../common/Badge';
import { Layers, AlertTriangle, ShieldAlert, Camera, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';

// Create pulsing divIcon based on emergency reason
const createActiveThreatIcon = (alert) => {
  const isGunshot = alert.emergencyType === 'gunshot';
  const isVerified = alert.threatStatus === 'verified_threat';

  let className = 'pulsing-marker-medical';

  if (isGunshot) {
    className = isVerified ? 'pulsing-marker-verified' : 'pulsing-marker-unverified';
  } else if (alert.emergencyType === 'fire') {
    className = 'pulsing-marker-fire';
  } else if (alert.emergencyType === 'panic') {
    className = 'pulsing-marker-panic';
  }

  return L.divIcon({
    className: 'custom-leaflet-threat-pin',
    html: `<div class="${className}"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11]
  });
};

export const ActiveThreatMap = () => {
  const { campusCenter, overlayFloorPlan, toggleFloorPlan } = useSettings();
  const { socket } = useSocket();
  const { alerts } = useAlerts();

  const [activeNodeMapData, setActiveNodeMapData] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchActiveNodes = async () => {
    try {
      setLoading(true);
      // Fetch both nodes and active alerts
      const [nodesRes, alertsRes] = await Promise.all([
        api.getNodes({ status: 'active' }),
        api.getAlerts({ status: 'new' }) // also includes acknowledged
      ]);

      const allActiveAlerts = alertsRes.alerts ? alertsRes.alerts.filter((a) => a.status !== 'resolved') : [];
      const nodes = nodesRes.nodes || [];

      // Join active alerts with their node geo-coordinates
      const joined = [];

      for (const alert of allActiveAlerts) {
        // find node coordinate
        let nodeMatch = nodes.find((n) => n.nodeId === alert.nodeId);
        if (!nodeMatch) {
          // fetch all nodes if not in active filter
          const allNodesRes = await api.getNodes();
          nodeMatch = allNodesRes.nodes?.find((n) => n.nodeId === alert.nodeId);
        }

        if (nodeMatch) {
          joined.push({
            alert,
            lat: nodeMatch.lat,
            lng: nodeMatch.lng,
            node: nodeMatch
          });
        }
      }

      setActiveNodeMapData(joined);
    } catch (err) {
      console.error('[ActiveThreatMap] Failed to load active map data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchActiveNodes();
  }, [alerts]);

  useEffect(() => {
    if (!socket) return;
    const handleUpdate = () => fetchActiveNodes();
    socket.on('alert:new', handleUpdate);
    socket.on('alert:updated', handleUpdate);
    socket.on('node:updated', handleUpdate);

    return () => {
      socket.off('alert:new', handleUpdate);
      socket.off('alert:updated', handleUpdate);
      socket.off('node:updated', handleUpdate);
    };
  }, [socket]);

  const floorPlanBounds = [
    [campusCenter.lat - 0.002, campusCenter.lng - 0.002],
    [campusCenter.lat + 0.002, campusCenter.lng + 0.002]
  ];

  return (
    <div className="map-wrapper">
      {/* Map Header Toolbar with Legend */}
      <div className="map-control-overlay" style={{ flexWrap: 'wrap', maxWidth: '600px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '0.75rem', color: '#e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ef4444' }}></span>
            <span>Gunshot Verified</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#f97316' }}></span>
            <span>Gunshot Unverified</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#3b82f6' }}></span>
            <span>Medical</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#f59e0b' }}></span>
            <span>Fire</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#a855f7' }}></span>
            <span>Panic</span>
          </div>
        </div>
      </div>

      <MapContainer
        center={[campusCenter.lat, campusCenter.lng]}
        zoom={campusCenter.zoom || 17}
        scrollWheelZoom={true}
        style={{ height: '100%', width: '100%', background: '#0a0d14' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          maxZoom={20}
        />

        {overlayFloorPlan && (
          <ImageOverlay
            url="/uploads/alerts/placeholder_verified_gunshot.svg"
            bounds={floorPlanBounds}
            opacity={0.35}
          />
        )}

        {activeNodeMapData.map(({ alert, lat, lng, node }) => (
          <Marker
            key={alert._id}
            position={[lat, lng]}
            icon={createActiveThreatIcon(alert)}
          >
            <Popup minWidth={240}>
              <div style={{ color: '#0f172a', padding: '4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                  <ThreatBadge threatStatus={alert.threatStatus} emergencyType={alert.emergencyType} />
                </div>

                <div style={{ fontWeight: 800, fontSize: '0.95rem', marginBottom: '2px' }}>
                  {alert.building} — {alert.room}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '6px' }}>
                  Node {alert.nodeId} • Seq #{alert.sequenceNumber}
                </div>

                {/* Plain statement when firearm was NOT verified */}
                {alert.threatStatus === 'unverified_audio_trigger' && (
                  <div
                    style={{
                      background: '#fff7ed',
                      border: '1px solid #fdba74',
                      padding: '6px 8px',
                      borderRadius: '4px',
                      color: '#c2410c',
                      fontSize: '0.74rem',
                      marginBottom: '6px',
                      lineHeight: 1.3
                    }}
                  >
                    <strong>Firearm NOT verified:</strong> Webcam vision analyzed frame and detected NO firearm. Acoustic trigger only.
                  </div>
                )}

                {alert.threatStatus === 'verified_threat' && (
                  <div
                    style={{
                      background: '#fef2f2',
                      border: '1px solid #fca5a5',
                      padding: '6px 8px',
                      borderRadius: '4px',
                      color: '#b91c1c',
                      fontSize: '0.74rem',
                      marginBottom: '6px',
                      lineHeight: 1.3
                    }}
                  >
                    <strong>VERIFIED FIREARM:</strong> Vision CNN detected firearm ({((alert.firearmConfidence || 0) * 100).toFixed(0)}%).
                  </div>
                )}

                <div style={{ fontSize: '0.75rem', color: '#475569', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Clock size={12} />
                  <span>Time: {new Date(alert.timestamp).toLocaleTimeString()}</span>
                </div>

                {alert.imageUrl && (
                  <div style={{ marginBottom: '8px', borderRadius: '4px', overflow: 'hidden', border: '1px solid #cbd5e1' }}>
                    <img
                      src={alert.imageUrl}
                      alt="Captured snapshot"
                      style={{ width: '100%', height: '110px', objectFit: 'cover', display: 'block' }}
                      onError={(e) => {
                        e.target.src = '/uploads/alerts/placeholder_verified_gunshot.svg';
                      }}
                    />
                  </div>
                )}

                <Link
                  to={`/cam-view?nodeId=${alert.nodeId}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    padding: '6px 10px',
                    backgroundColor: '#2563eb',
                    color: 'white',
                    borderRadius: '4px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    textDecoration: 'none'
                  }}
                >
                  <Camera size={13} /> View Live Camera Feed
                </Link>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
};
