import React, { createContext, useContext, useState, useEffect } from 'react';

const SettingsContext = createContext(null);

export const SettingsProvider = ({ children }) => {
  const [theme, setTheme] = useState(() => localStorage.getItem('cp_theme') || 'dark');
  const [soundEnabled, setSoundEnabled] = useState(() => {
    const saved = localStorage.getItem('cp_sound');
    return saved !== null ? saved === 'true' : true;
  });
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem('cp_volume');
    return saved ? parseFloat(saved) : 0.8;
  });
  const [campusCenter, setCampusCenter] = useState(() => {
    const saved = localStorage.getItem('cp_campus_center');
    return saved ? JSON.parse(saved) : { lat: 14.5995, lng: 120.9842, zoom: 17 };
  });
  const [overlayFloorPlan, setOverlayFloorPlan] = useState(false);

  // Sync theme with HTML root attribute
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('cp_theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('cp_sound', String(soundEnabled));
  }, [soundEnabled]);

  useEffect(() => {
    localStorage.setItem('cp_volume', String(volume));
  }, [volume]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const toggleSound = () => {
    setSoundEnabled((prev) => !prev);
  };

  const toggleFloorPlan = () => {
    setOverlayFloorPlan((prev) => !prev);
  };

  const updateCampusCenter = (newCoords) => {
    setCampusCenter(newCoords);
    localStorage.setItem('cp_campus_center', JSON.stringify(newCoords));
  };

  const value = {
    theme,
    toggleTheme,
    soundEnabled,
    toggleSound,
    volume,
    setVolume,
    campusCenter,
    updateCampusCenter,
    overlayFloorPlan,
    toggleFloorPlan
  };

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
};

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
};
