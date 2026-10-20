import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { useSocket } from './SocketContext';
import { useSettings } from './SettingsContext';
import { playVerifiedThreatAlarm, playWarningChime } from '../services/sound';

const AlertContext = createContext(null);

export const AlertProvider = ({ children }) => {
  const { socket } = useSocket();
  const { soundEnabled, volume } = useSettings();

  const [alerts, setAlerts] = useState([]);
  const [counts, setCounts] = useState({
    gunshot: 0,
    medical: 0,
    fire: 0,
    panic: 0,
    totalActive: 0,
    verifiedThreats: 0
  });
  const [latestAlert, setLatestAlert] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    status: 'all',
    type: 'all',
    building: 'all'
  });

  const fetchAlerts = useCallback(async (currentFilters = filters) => {
    try {
      setLoading(true);
      const res = await api.getAlerts(currentFilters);
      if (res.success) {
        setAlerts(res.alerts);
        if (res.counts) {
          setCounts(res.counts);
        }
        if (res.alerts.length > 0 && !latestAlert) {
          setLatestAlert(res.alerts[0]);
        }
      }
    } catch (err) {
      console.error('[AlertContext] Failed to load alerts:', err.message);
    } finally {
      setLoading(false);
    }
  }, [filters, latestAlert]);

  // Load initial alerts
  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  // Real-time Socket.IO Listeners
  useEffect(() => {
    if (!socket) return;

    const handleNewAlert = (newAlert) => {
      console.log('[AlertContext] Realtime alert received:', newAlert);

      // Play alert sound if enabled
      if (soundEnabled) {
        if (newAlert.threatStatus === 'verified_threat') {
          playVerifiedThreatAlarm(volume);
        } else {
          playWarningChime(volume);
        }
      }

      setLatestAlert(newAlert);

      setAlerts((prevAlerts) => {
        // Prepend and sort by priority then timestamp
        const updated = [newAlert, ...prevAlerts.filter((a) => a._id !== newAlert._id)];
        return updated.sort((a, b) => {
          if (a.priority !== b.priority) return a.priority - b.priority;
          return new Date(b.timestamp) - new Date(a.timestamp);
        });
      });

      // Update counters
      setCounts((prev) => ({
        ...prev,
        [newAlert.emergencyType]: (prev[newAlert.emergencyType] || 0) + 1,
        totalActive: prev.totalActive + 1,
        verifiedThreats: newAlert.threatStatus === 'verified_threat' ? prev.verifiedThreats + 1 : prev.verifiedThreats
      }));
    };

    const handleAlertUpdated = (updatedAlert) => {
      setAlerts((prevAlerts) =>
        prevAlerts.map((a) => (a._id === updatedAlert._id ? updatedAlert : a))
      );

      // Refresh aggregate counts
      api.getAlerts().then((res) => {
        if (res.counts) setCounts(res.counts);
      }).catch(() => {});
    };

    socket.on('alert:new', handleNewAlert);
    socket.on('alert:updated', handleAlertUpdated);

    return () => {
      socket.off('alert:new', handleNewAlert);
      socket.off('alert:updated', handleAlertUpdated);
    };
  }, [socket, soundEnabled, volume]);

  const acknowledgeAlert = async (id) => {
    try {
      const res = await api.updateAlertStatus(id, 'acknowledged');
      if (res.success && res.alert) {
        setAlerts((prev) => prev.map((a) => (a._id === id ? res.alert : a)));
      }
      return res;
    } catch (err) {
      throw err;
    }
  };

  const resolveAlert = async (id) => {
    try {
      const res = await api.updateAlertStatus(id, 'resolved');
      if (res.success && res.alert) {
        setAlerts((prev) => prev.map((a) => (a._id === id ? res.alert : a)));
      }
      return res;
    } catch (err) {
      throw err;
    }
  };

  const value = {
    alerts,
    counts,
    latestAlert,
    loading,
    filters,
    setFilters,
    fetchAlerts,
    acknowledgeAlert,
    resolveAlert
  };

  return <AlertContext.Provider value={value}>{children}</AlertContext.Provider>;
};

export const useAlerts = () => {
  const context = useContext(AlertContext);
  if (!context) {
    throw new Error('useAlerts must be used within an AlertProvider');
  }
  return context;
};
