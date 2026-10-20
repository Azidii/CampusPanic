import React from 'react';
import { StatsOverview } from '../components/dashboard/StatsOverview';
import { AlertFeed } from '../components/dashboard/AlertFeed';
import { ShieldAlert, Radio } from 'lucide-react';

export const DashboardPage = () => {
  return (
    <div>
      {/* Page Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Radio size={22} color="#ef4444" />
            Security Operations Dashboard
          </h1>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }}>
            Real-time emergency telemetry feed sorted by priority. Acoustic triggers cross-verified via vision classifier.
          </p>
        </div>
      </div>

      {/* Aggregate Counts and Node Online/Offline Summary */}
      <StatsOverview />

      {/* Live Priority Alert Stream */}
      <AlertFeed />
    </div>
  );
};
