import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, ImageOverlay, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useSettings } from '../../context/SettingsContext';
import { api } from '../../services/api';
import { useSocket } from '../../context/SocketContext';
import { MapPin, Radio, Camera, Cpu, Layers } from 'lucide-react';
import { Link } from 'react-router-dom';

// Helper to center map dynamically when selectedNodeId changes
const MapRecenter = ({ center }) => {
  const map = useMap();
  useEffect(() => {
    if (center && center.lat && center.lng) {
      map.setView([center.lat, center.lng], 17);
    }
  }, [center, map]);
  return null;
};

// Custom DivIcon for standard nodes
const createNodeIcon = (status) => {
  let color = '#10b981'; // online green
  let glow = '0 0 10px rgba(16, 185, 129, 0.6)';

  if (status === 'active') {
    color = '#ef4444'; // active alert red
    glow = '0 0 16px rgba(239, 68, 68, 0.8)';
  } else if (status === 'offline') {
    color = '#64748b'; // offline gray
    glow = 'none';
  }

  return L.divIcon({
    className: 'custom-leaflet-pin',
    html: `
      <div style="
        width: 18px;
        height: 18px;
        background-color: ${color};
        border: 2px solid #ffffff;
        border-radius: 50%;
        box-shadow: ${glow};
        display: flex;
        align-items: center;
        justify-content: center;
      "></div>
    `,
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });
};

export const CampusMap = ({ selectedNodeId }) => {
  const { campusCenter, overlayFloorPlan, toggleFloorPlan } = useSettings();
  const { socket } = useSocket();
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeCenter, setActiveCenter] = useState(campusCenter);

  const fetchNodes = async () => {
    try {
      const res = await api.getNodes();
      if (res.success && res.nodes) {
        setNodes(res.nodes);
        if (selectedNodeId) {
          const match = res.nodes.find((n) => n.nodeId === selectedNodeId);
          if (match) {
            setActiveCenter({ lat: match.lat, lng: match.lng });
          }
        }
      }
    } catch (err) {
      console.error('[Map] Failed to load nodes:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNodes();
  }, [selectedNodeId]);

  // Realtime updates on node status
  useEffect(() => {
    if (!socket) return;
    const handleNodeUpdate = (updatedNode) => {
      setNodes((prev) =>
        prev.map((n) => (n.nodeId === updatedNode.nodeId ? updatedNode : n))
      );
    };
    socket.on('node:updated', handleNodeUpdate);
    socket.on('node:created', () => fetchNodes());
    socket.on('node:deleted', () => fetchNodes());

    return () => {
      socket.off('node:updated', handleNodeUpdate);
      socket.off('node:created');
      socket.off('node:deleted');
    };
  }, [socket]);

  // Floor plan bounds roughly covering the sample nodes area
  const floorPlanBounds = [
    [campusCenter.lat - 0.002, campusCenter.lng - 0.002],
    [campusCenter.lat + 0.002, campusCenter.lng + 0.002]
  ];

  return (
    <div className="map-wrapper">
      {/* Overlay Toggle Toolbar */}
      <div className="map-control-overlay">
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.82rem', color: 'white' }}>
          <Layers size={16} color="#38bdf8" />
          <span>Campus Floor Plan Overlay</span>
          <input
            type="checkbox"
            checked={overlayFloorPlan}
            onChange={toggleFloorPlan}
            style={{ cursor: 'pointer' }}
          />
        </label>
      </div>

      <MapContainer
        center={[activeCenter.lat, activeCenter.lng]}
        zoom={activeCenter.zoom || 17}
        scrollWheelZoom={true}
        style={{ height: '100%', width: '100%', background: '#0a0d14' }}
      >
        <MapRecenter center={activeCenter} />

        {/* High-contrast CartoDB Dark Matter tiles */}
        <TileLayer
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          maxZoom={20}
        />

        {/* Optional Custom Campus / Floor Image Overlay */}
        {overlayFloorPlan && (
          <ImageOverlay
            url="/uploads/alerts/placeholder_verified_gunshot.svg"
            bounds={floorPlanBounds}
            opacity={0.35}
          />
        )}

        {/* Markers for all room nodes */}
        {nodes.map((node) => (
          <Marker
            key={node._id}
            position={[node.lat, node.lng]}
            icon={createNodeIcon(node.status)}
          >
            <Popup>
              <div style={{ color: '#0f172a', minWidth: '180px', padding: '4px' }}>
                <div style={{ fontWeight: 800, fontSize: '0.95rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '4px', marginBottom: '6px' }}>
                  {node.building} — {node.room}
                </div>
                <div style={{ fontSize: '0.8rem', marginBottom: '4px' }}>
                  <strong>Node ID:</strong> {node.nodeId}
                </div>
                <div style={{ fontSize: '0.8rem', marginBottom: '4px' }}>
                  <strong>Status:</strong>{' '}
                  <span
                    style={{
                      fontWeight: 700,
                      color: node.status === 'active' ? '#dc2626' : node.status === 'online' ? '#16a34a' : '#64748b',
                      textTransform: 'uppercase'
                    }}
                  >
                    {node.status}
                  </span>
                </div>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '8px' }}>
                  Last Seen: {new Date(node.lastSeen).toLocaleTimeString()}
                </div>
                {node.cameraId && (
                  <Link
                    to={`/cam-view?nodeId=${node.nodeId}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '0.78rem',
                      color: '#2563eb',
                      fontWeight: 600,
                      textDecoration: 'none'
                    }}
                  >
                    <Camera size={14} /> View Node Camera
                  </Link>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
};
