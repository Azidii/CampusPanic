import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';

import { AuthProvider, useAuth } from './context/AuthContext';
import { SettingsProvider } from './context/SettingsContext';
import { SocketProvider } from './context/SocketContext';
import { AlertProvider } from './context/AlertContext';

import { MainLayout } from './components/layout/MainLayout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { CamViewPage } from './pages/CamViewPage';
import { AllCamsPage } from './pages/AllCamsPage';
import { MapViewPage } from './pages/MapViewPage';
import { ActiveNodesMapPage } from './pages/ActiveNodesMapPage';
import { BroadcasterPage } from './pages/BroadcasterPage';
import { ProfilePage } from './pages/ProfilePage';
import { SettingsPage } from './pages/SettingsPage';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { NotFoundPage } from './pages/NotFoundPage';

// Protected Route Guard
const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0d14', color: '#94a3b8' }}>
        Verifying Security Credentials...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
};

// Admin Only Route Guard
const AdminRoute = ({ children }) => {
  const { isAuthenticated, isAdmin, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0d14', color: '#94a3b8' }}>
        Verifying Administrator Privileges...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return children;
};

export const App = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SettingsProvider>
          <SocketProvider>
            <AlertProvider>
              <Routes>
                {/* Public Route */}
                <Route path="/login" element={<LoginPage />} />

                {/* Protected Security Operations Console Routes */}
                <Route
                  path="/"
                  element={
                    <ProtectedRoute>
                      <MainLayout />
                    </ProtectedRoute>
                  }
                >
                  <Route index element={<DashboardPage />} />
                  <Route path="cam-view" element={<CamViewPage />} />
                  <Route path="cameras" element={<AllCamsPage />} />
                  <Route path="map" element={<MapViewPage />} />
                  <Route path="active-nodes-map" element={<ActiveNodesMapPage />} />
                  <Route path="streamer" element={<BroadcasterPage />} />
                  <Route path="profile" element={<ProfilePage />} />
                  <Route path="settings" element={<SettingsPage />} />

                  {/* Admin Only Route */}
                  <Route
                    path="admin/users"
                    element={
                      <AdminRoute>
                        <AdminUsersPage />
                      </AdminRoute>
                    }
                  />

                  {/* 404 Catch-all */}
                  <Route path="*" element={<NotFoundPage />} />
                </Route>
              </Routes>
            </AlertProvider>
          </SocketProvider>
        </SettingsProvider>
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;
