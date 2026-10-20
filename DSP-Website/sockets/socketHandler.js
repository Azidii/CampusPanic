let ioInstance = null;

export const initSocketIO = (io) => {
  ioInstance = io;

  io.on('connection', (socket) => {
    console.log(`[Socket.IO] Client connected: ${socket.id}`);

    socket.on('join:room', (room) => {
      socket.join(room);
      console.log(`[Socket.IO] Client ${socket.id} joined room: ${room}`);
    });

    socket.on('leave:room', (room) => {
      socket.leave(room);
    });

    socket.on('camera:stream_frame', (data) => {
      socket.broadcast.emit('camera:live_frame', {
        cameraId: data.cameraId,
        frameData: data.frameData,
        timestamp: data.timestamp || Date.now()
      });
    });

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
