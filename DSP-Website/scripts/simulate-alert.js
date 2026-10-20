import { computeAlertChecksum } from '../utils/checksum.js';
import { config } from '../config/config.js';

const SERVER_BASE = process.env.SERVER_URL || `http://localhost:${config.port || 5000}`;
const INGEST_URL = `${SERVER_BASE}/api/alerts/ingest`;
const API_KEY = config.deviceApiKey;

const SAMPLE_BASE64_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const sendPacket = async (title, packet, customApiKey = API_KEY) => {
  console.log(`\n======================================================`);
  console.log(`[Simulator] ${title}`);
  console.log(`Target: POST ${INGEST_URL}`);
  console.log(`Payload:`, JSON.stringify(packet, null, 2));

  try {
    const res = await fetch(INGEST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-device-api-key': customApiKey
      },
      body: JSON.stringify(packet)
    });

    const status = res.status;
    const data = await res.json().catch(() => ({}));

    if (status >= 200 && status < 300) {
      console.log(`>> Response: [${status}] OK`);
      console.log(`>> Server ACK:`, data);
      return { success: true, status, data };
    } else {
      console.log(`>> Response: [${status}] Rejected as expected`);
      console.log(`>> Server Response:`, data);
      return { success: false, status, data };
    }
  } catch (error) {
    console.error(`>> Network error connecting to ${INGEST_URL}:`, error.message);
    console.log(`   (Make sure the server is running on port ${config.port || 5000})`);
    return { success: false, error: error.message };
  }
};

const runSimulation = async () => {
  console.log(`\n==========================================================`);
  console.log(` CAMPUSPANIC ALERT PACKET SIMULATOR`);
  console.log(` Testing ESP32 & Python Gateway Ingest Protocol`);
  console.log(` Server: ${SERVER_BASE}`);
  console.log(` Device API Key: ${API_KEY.slice(0, 8)}...`);
  console.log(`==========================================================`);

  const runSeq = Math.floor(Date.now() / 1000) % 10000;

  const verifiedSeq = 5000 + runSeq;
  const verifiedPacket = {
    nodeId: 'SC-101',
    building: 'Science Complex',
    room: 'Lab 101',
    emergencyType: 'gunshot',
    threatStatus: 'verified_threat',
    sequenceNumber: verifiedSeq,
    audioConfidence: 0.96,
    firearmConfidence: 0.92,
    timestamp: new Date().toISOString(),
    image: SAMPLE_BASE64_IMAGE
  };
  verifiedPacket.checksum = computeAlertChecksum(verifiedPacket);

  await sendPacket('1. TEST: Verified Gunshot Threat (AI Vision Verified)', verifiedPacket);
  await new Promise((r) => setTimeout(r, 1200));

  const unverifiedSeq = 6000 + runSeq;
  const unverifiedPacket = {
    nodeId: 'SC-204',
    building: 'Science Complex',
    room: 'Lecture Hall 204',
    emergencyType: 'gunshot',
    threatStatus: 'unverified_audio_trigger',
    sequenceNumber: unverifiedSeq,
    audioConfidence: 0.87,
    firearmConfidence: 0.08,
    timestamp: new Date().toISOString(),
    image: SAMPLE_BASE64_IMAGE
  };
  unverifiedPacket.checksum = computeAlertChecksum(unverifiedPacket);

  await sendPacket('2. TEST: Unverified Audio Trigger (Gunshot sound detected, Firearm NOT verified)', unverifiedPacket);
  await new Promise((r) => setTimeout(r, 1200));

  const medicalSeq = 7000 + runSeq;
  const medicalPacket = {
    nodeId: 'ENG-102',
    building: 'Engineering Hall',
    room: 'Robotics Workshop 102',
    emergencyType: 'medical',
    threatStatus: 'manual_alert',
    sequenceNumber: medicalSeq,
    timestamp: new Date().toISOString()
  };
  medicalPacket.checksum = computeAlertChecksum(medicalPacket);

  await sendPacket('3. TEST: Manual Medical Emergency (Three-button panel pressed)', medicalPacket);
  await new Promise((r) => setTimeout(r, 1200));

  console.log('\n[Requirement Test] Duplicates must be ignored but still ACKed:');
  await sendPacket('4. TEST: Duplicate Packet (Same nodeId + sequenceNumber)', verifiedPacket);
  await new Promise((r) => setTimeout(r, 1200));

  const badChecksumPacket = {
    nodeId: 'ENG-205',
    building: 'Engineering Hall',
    room: 'Computer Lab 205',
    emergencyType: 'fire',
    threatStatus: 'manual_alert',
    sequenceNumber: 8000 + runSeq,
    timestamp: new Date().toISOString(),
    checksum: 'invalid_bad_checksum_12345678'
  };

  console.log('\n[Requirement Test] Bad checksum must be rejected:');
  await sendPacket('5. TEST: Bad Checksum Packet (Tampered / Corrupted Data)', badChecksumPacket);

  console.log(`\n==========================================================`);
  console.log(` Simulation run complete! Check the live web dashboard.`);
  console.log(`==========================================================\n`);
};

runSimulation();
