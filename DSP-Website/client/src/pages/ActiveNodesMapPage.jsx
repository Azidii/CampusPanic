import React from 'react';
import { ActiveThreatMap } from '../components/map/ActiveThreatMap';
import { Flame, AlertTriangle } from 'lucide-react';

export const ActiveNodesMapPage = () => {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Flame size={24} color="#ef4444" />
            Active Threat & Emergency Incident Map
          </h1>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }}>
            High-priority tactical view showing exclusively triggered room nodes with pulsing alert indicators, color-coded by emergency reason.
          </p>
        </div>
      </div>

      <ActiveThreatMap />
    </div>
  );
};
