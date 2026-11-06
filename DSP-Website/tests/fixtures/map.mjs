// Synthetic fixtures for tests only. Never imported by production routes or browser scripts.
export const nodes = [
  { nodeId: 'TEST-CAMERA-A', name: 'Test camera A', building: 'RSY', room: 'C101', videoEnabled: true,
    video: { cameraConnected: true, live: true }, lastSeen: '2026-01-01T00:00:00Z' },
  { nodeId: 'TEST-CAMERA-B', name: 'Test camera B', building: 'RSY', room: 'C101', status: 'active', videoEnabled: true,
    video: { cameraConnected: false, live: false } },
  { nodeId: 'TEST-SENSOR', name: 'Test sensor', building: 'RG Birrey', room: 'R602', status: 'active',
    audio: { paired: true, connected: true, lastSeen: '2026-01-01T00:00:00Z' } },
  { nodeId: 'TEST-UNKNOWN', name: 'Test legacy node', building: 'RG Birrey', room: 'Main Hall (3rd Floor Faculty Room)', status: 'online' },
  { nodeId: 'TEST-UNMAPPED', name: '<img src=x onerror=alert(1)>', building: 'RSY', room: 'Unmapped test location' }
];
export const alerts = [
  { _id: 'test-alert-1', nodeId: 'TEST-CAMERA-B', building: 'RSY', room: 'C101', emergencyType: 'fire', status: 'new', timestamp: '2025-01-01T00:00:00Z' },
  { _id: 'test-alert-2', nodeId: 'TEST-CAMERA-B', building: 'RSY', room: 'C101', emergencyType: 'medical', status: 'acknowledged' },
  { _id: 'test-alert-3', nodeId: 'TEST-REMOVED', building: 'RG Birrey', room: 'R602', emergencyType: 'panic', status: 'new' },
  { _id: 'test-alert-4', nodeId: 'TEST-CAMERA-A', building: 'RSY', room: 'C201', emergencyType: 'gunshot', status: 'new' },
  { _id: 'test-alert-5', nodeId: 'TEST-UNMAPPED', building: 'RSY', room: 'Unmapped test location', emergencyType: 'fire', status: 'new' },
  { _id: 'test-alert-6', nodeId: 'TEST-UNMAPPED', building: 'Unknown test building', room: 'C101', emergencyType: 'panic', status: 'new' },
  { _id: 'test-alert-7', nodeId: 'TEST-CAMERA-A', building: 'RSY', room: 'C101', emergencyType: 'panic', status: 'resolved' }
];
export const snapshot = { success: true, nodes, activeAlerts: alerts.filter(a => a.status !== 'resolved'), alerts: [], counts: { unresolved: 6 },
  receiver: { ready: false, message: 'Isolated test fixture; no model worker', addresses: [] }, audioReceiver: { ready: false } };
