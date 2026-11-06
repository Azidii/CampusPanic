import { connectDB, disconnectDB } from '../config/db.js';
import { config } from '../config/config.js';
import { User } from '../models/User.js';
import { Node } from '../models/Node.js';
import { Alert } from '../models/Alert.js';
import { Camera } from '../models/Camera.js';
import { computeAlertChecksum } from '../utils/checksum.js';

const seedDatabase = async () => {
  try {
    const name = new URL(config.mongoUri).pathname.slice(1);
    if (process.env.NODE_ENV !== 'test' || !/^campuspanic_[a-z0-9_]+_seed$/.test(name)) throw new Error('Seed only an explicitly named campuspanic_*_seed database with NODE_ENV=test. Never seed mainDB.');
    console.log('[Seed] Connecting to isolated seed database...');
    await connectDB();

    console.log('[Seed] Clearing existing test data...');
    await Promise.all([
      User.deleteMany({}),
      Node.deleteMany({}),
      Alert.deleteMany({}),
      Camera.deleteMany({})
    ]);

    console.log('[Seed] Creating users...');
    const adminPasswordHash = await User.hashPassword(config.admin.password);
    const admin = await User.create({
      name: config.admin.name,
      email: config.admin.email,
      passwordHash: adminPasswordHash,
      role: 'admin',
      isActive: true,
      assignedBuilding: config.admin.assignedBuilding
    });

    const guardPasswordHash = await User.hashPassword('Guard123!');
    const guard = await User.create({
      name: 'Security Guard Reyes',
      email: 'guard@campuspanic.edu',
      passwordHash: guardPasswordHash,
      role: 'user',
      isActive: true,
      assignedBuilding: 'RSY'
    });

    console.log(`[Seed] Created Admin: ${admin.email}`);
    console.log(`[Seed] Created User: ${guard.email}`);

    const campusCenter = { lat: 14.5995, lng: 120.9842 };

    console.log('[Seed] Creating 6 campus nodes...');
    const nodesData = [
      {
        nodeId: 'SC-101',
        building: 'RSY',
        room: 'Lab 101',
        lat: campusCenter.lat + 0.0008,
        lng: campusCenter.lng - 0.0007,
        status: 'active',
        cameraId: 'CAM-SC101',
        lastSeen: new Date()
      },
      {
        nodeId: 'SC-204',
        building: 'RSY',
        room: 'Lecture Hall 204',
        lat: campusCenter.lat + 0.0011,
        lng: campusCenter.lng - 0.0003,
        status: 'active',
        cameraId: 'CAM-SC204',
        lastSeen: new Date()
      },
      {
        nodeId: 'SC-310',
        building: 'RSY',
        room: 'Chemistry Prep 310',
        lat: campusCenter.lat + 0.0013,
        lng: campusCenter.lng - 0.0009,
        status: 'online',
        cameraId: 'CAM-SC310',
        lastSeen: new Date()
      },
      {
        nodeId: 'ENG-102',
        building: 'RG Birrey',
        room: 'Robotics Workshop 102',
        lat: campusCenter.lat - 0.0006,
        lng: campusCenter.lng + 0.0008,
        status: 'active',
        cameraId: 'CAM-ENG102',
        lastSeen: new Date()
      },
      {
        nodeId: 'ENG-205',
        building: 'RG Birrey',
        room: 'Computer Lab 205',
        lat: campusCenter.lat - 0.0009,
        lng: campusCenter.lng + 0.0011,
        status: 'online',
        cameraId: 'CAM-ENG205',
        lastSeen: new Date()
      },
      {
        nodeId: 'ENG-308',
        building: 'RG Birrey',
        room: 'Faculty Lounge 308',
        lat: campusCenter.lat - 0.0012,
        lng: campusCenter.lng + 0.0005,
        status: 'offline',
        cameraId: 'CAM-ENG308',
        lastSeen: new Date(Date.now() - 4 * 60 * 60 * 1000)
      }
    ];

    const nodes = await Node.insertMany(nodesData.map(node => ({...node, name: `Demo ${node.nodeId}`, lat:null, lng:null})));
    console.log(`[Seed] Seeded ${nodes.length} room nodes.`);

    console.log('[Seed] Creating camera feeds...');
    const camerasData = [
      {
        cameraId: 'CAM-SC101',
        label: 'RSY - Lab 101',
        nodeId: 'SC-101',
        building: 'RSY',
        room: 'Lab 101',
        online: true,
        lastFrameAt: new Date(),
        lastFrameUrl: '/uploads/alerts/placeholder_verified_gunshot.svg'
      },
      {
        cameraId: 'CAM-SC204',
        label: 'RSY - Lecture 204',
        nodeId: 'SC-204',
        building: 'RSY',
        room: 'Lecture Hall 204',
        online: true,
        lastFrameAt: new Date(),
        lastFrameUrl: '/uploads/alerts/placeholder_unverified_audio.svg'
      },
      {
        cameraId: 'CAM-SC310',
        label: 'RSY - Chem Prep 310',
        nodeId: 'SC-310',
        building: 'RSY',
        room: 'Chemistry Prep 310',
        online: true,
        lastFrameAt: new Date(Date.now() - 60000),
        lastFrameUrl: '/uploads/alerts/placeholder_manual_alert.svg'
      },
      {
        cameraId: 'CAM-ENG102',
        label: 'RG Birrey - Robotics 102',
        nodeId: 'ENG-102',
        building: 'RG Birrey',
        room: 'Robotics Workshop 102',
        online: true,
        lastFrameAt: new Date(),
        lastFrameUrl: '/uploads/alerts/placeholder_manual_alert.svg'
      },
      {
        cameraId: 'CAM-ENG205',
        label: 'RG Birrey - Lab 205',
        nodeId: 'ENG-205',
        building: 'RG Birrey',
        room: 'Computer Lab 205',
        online: true,
        lastFrameAt: new Date(Date.now() - 120000),
        lastFrameUrl: '/uploads/alerts/placeholder_manual_alert.svg'
      },
      {
        cameraId: 'CAM-ENG308',
        label: 'RG Birrey - Faculty 308',
        nodeId: 'ENG-308',
        building: 'RG Birrey',
        room: 'Faculty Lounge 308',
        online: false,
        lastFrameAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
        lastFrameUrl: null
      }
    ];

    await Camera.insertMany(camerasData);
    console.log(`[Seed] Seeded ${camerasData.length} camera records.`);

    console.log('[Seed] Creating alerts of each type...');
    const now = Date.now();

    const alertsRaw = [
      {
        nodeId: 'SC-101',
        building: 'RSY',
        room: 'Lab 101',
        emergencyType: 'gunshot',
        threatStatus: 'verified_threat',
        priority: 1,
        sequenceNumber: 101,
        timestamp: new Date(now - 2 * 60 * 1000),
        imageUrl: '/uploads/alerts/placeholder_verified_gunshot.svg',
        audioConfidence: 0.98,
        firearmConfidence: 0.94,
        status: 'new'
      },
      {
        nodeId: 'SC-204',
        building: 'RSY',
        room: 'Lecture Hall 204',
        emergencyType: 'gunshot',
        threatStatus: 'unverified_audio_trigger',
        priority: 3,
        sequenceNumber: 102,
        timestamp: new Date(now - 14 * 60 * 1000),
        imageUrl: '/uploads/alerts/placeholder_unverified_audio.svg',
        audioConfidence: 0.88,
        firearmConfidence: 0.12,
        status: 'acknowledged',
        acknowledgedBy: 'Security Guard Reyes',
        acknowledgedAt: new Date(now - 10 * 60 * 1000)
      },
      {
        nodeId: 'ENG-102',
        building: 'RG Birrey',
        room: 'Robotics Workshop 102',
        emergencyType: 'medical',
        threatStatus: 'manual_alert',
        priority: 2,
        sequenceNumber: 103,
        timestamp: new Date(now - 7 * 60 * 1000),
        imageUrl: '/uploads/alerts/placeholder_manual_alert.svg',
        audioConfidence: null,
        firearmConfidence: null,
        status: 'new'
      },
      {
        nodeId: 'ENG-205',
        building: 'RG Birrey',
        room: 'Computer Lab 205',
        emergencyType: 'fire',
        threatStatus: 'manual_alert',
        priority: 2,
        sequenceNumber: 104,
        timestamp: new Date(now - 35 * 60 * 1000),
        imageUrl: null,
        status: 'acknowledged',
        acknowledgedBy: 'Chief of Campus Security',
        acknowledgedAt: new Date(now - 30 * 60 * 1000)
      },
      {
        nodeId: 'SC-310',
        building: 'RSY',
        room: 'Chemistry Prep 310',
        emergencyType: 'panic',
        threatStatus: 'manual_alert',
        priority: 2,
        sequenceNumber: 105,
        timestamp: new Date(now - 75 * 60 * 1000),
        imageUrl: null,
        status: 'resolved',
        acknowledgedBy: 'Security Guard Reyes',
        acknowledgedAt: new Date(now - 70 * 60 * 1000),
        resolvedAt: new Date(now - 50 * 60 * 1000)
      }
    ];

    for (const a of alertsRaw) {
      a.checksum = computeAlertChecksum(a);
      await Alert.create(a);
    }

    console.log(`[Seed] Seeded ${alertsRaw.length} sample alerts with valid checksums.`);
    console.log('---------------------------------------------------------');
    console.log('Database Seeding Complete!');
    console.log(`Admin Login: ${config.admin.email} / ${config.admin.password}`);
    console.log(`User Login:  guard@campuspanic.edu / Guard123!`);
    console.log('---------------------------------------------------------');

    await disconnectDB();
    process.exit(0);
  } catch (error) {
    console.error('[Seed Error] Failed to seed database:', error);
    process.exit(1);
  }
};

seedDatabase();
