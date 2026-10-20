import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { CampusMap } from '../components/map/CampusMap';
import { MapPin, Info } from 'lucide-react';

export const MapViewPage = () => {
  const [searchParams] = useSearchParams();
  const selectedNodeId = searchParams.get('nodeId');

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <MapPin size={24} color="#38bdf8" />
            Campus Telemetry Map
          </h1>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }}>
            Geospatial room sensor node network across campus facilities. Click any marker for room diagnostics and linked camera feeds.
          </p>
        </div>

        {/* Legend */}
        <div className="card" style={{ padding: '8px 16px', display: 'flex', gap: '16px', alignItems: 'center', fontSize: '0.8rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#10b981' }} />
            <span>Online Node</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ef4444' }} />
            <span>Active Incident</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#64748b' }} />
            <span>Offline</span>
          </div>
        </div>
      </div>

      <CampusMap selectedNodeId={selectedNodeId} />
    </div>
  );
};
