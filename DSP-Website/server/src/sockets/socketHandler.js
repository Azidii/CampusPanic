let ioInstance = null;

export const initSocketIO = (io) => {
  ioInstance = io;

  io.on('connection', (socket) => {
    console.log(`[Socket.IO] Client connected: ${socket.id}`);

    // Join specific room for cameras or alert feeds
    socket.on('join:room', (room) => {
      socket.join(room);
      console.log(`[Socket.IO] Client ${socket.id} joined room: ${room}`);
    });

    socket.on('leave:room', (room) => {
      socket.leave(room);
    });

    // Real-time camera frame stream relay from browser webcam / gateway broadcaster
    socket.on('camera:stream_frame', (data) => {
      // Broadcast live frame to all monitoring security dashboard clients
      socket.broadcast.emit('camera:live_frame', {
        cameraId: data.cameraId,
        frameData: data.frameData, // base64 image or blob url
        timestamp: data.timestamp || Date.now()
      });
    });

    // WebRTC Signaling relay (for peer-to-peer laptop camera feed)
    socket.on('webrtc:offer', (data) => {
      socket.broadcast.emit('webrtc:offer', data);
    });

    socket.on('webrtc:answer', (data) => {
      socket.broadcast.emit('webrtc:answer', data);
    });

    socket.on('webrtc:candidate', (data) => {
      socket.broadcast.emit('webrtc:candidate', data);
    });

    socket.on('disconnect', (reason) => {
      console.log(`[Socket.IO] Client disconnected: ${socket.id} (${reason})`);
    });
  });

  return ioInstance;
};

export const getSocketIO = () => {
  return ioInstance;
};
