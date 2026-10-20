/**
 * Camera Gateway Broadcaster Controller - broadcaster.js
 * Enables laptops & mobile devices to act as security verification cameras
 */

document.addEventListener('DOMContentLoaded', () => {
  const video = document.getElementById('localVideo');
  const startBtn = document.getElementById('startBroadcastBtn');
  const stopBtn = document.getElementById('stopBroadcastBtn');
  const snapBtn = document.getElementById('manualSnapshotBtn');
  const cameraSelect = document.getElementById('broadcastCameraSelect');
  const fpsSelect = document.getElementById('broadcastFpsSelect');
  const framesSentEl = document.getElementById('framesSentCount');

  let localStream = null;
  let broadcastInterval = null;
  let framesSent = 0;
  const hiddenCanvas = document.createElement('canvas');

  if (startBtn) {
    startBtn.addEventListener('click', async () => {
      try {
        startBtn.disabled = true;
        startBtn.textContent = 'Requesting Camera...';

        localStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        });

        if (video) {
          video.srcObject = localStream;
          video.play();
        }

        const idleMsg = document.getElementById('streamIdleMsg');
        if (idleMsg) idleMsg.style.display = 'none';

        startBtn.style.display = 'none';
        if (stopBtn) stopBtn.style.display = 'inline-flex';
        if (snapBtn) snapBtn.disabled = false;

        const fps = parseInt(fpsSelect ? fpsSelect.value : '1', 10) || 1;
        startTransmitting(fps);

        window.showToast('Camera streaming live to security server', 'success');
      } catch (err) {
        console.error('Camera access failed:', err);
        window.showToast(`Camera permission error: ${err.message}`, 'error');
        startBtn.disabled = false;
        startBtn.textContent = 'Start Camera Stream';
      }
    });
  }

  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      stopTransmitting();
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
        localStream = null;
      }
      if (video) video.srcObject = null;

      const idleMsg = document.getElementById('streamIdleMsg');
      if (idleMsg) idleMsg.style.display = 'flex';

      if (startBtn) {
        startBtn.style.display = 'inline-flex';
        startBtn.disabled = false;
        startBtn.textContent = 'Start Camera Stream';
      }
      stopBtn.style.display = 'none';
      if (snapBtn) snapBtn.disabled = true;

      window.showToast('Camera broadcast stopped', 'info');
    });
  }

  function startTransmitting(fps) {
    const intervalMs = Math.round(1000 / fps);
    broadcastInterval = setInterval(captureAndSendFrame, intervalMs);
  }

  function stopTransmitting() {
    if (broadcastInterval) {
      clearInterval(broadcastInterval);
      broadcastInterval = null;
    }
  }

  async function captureAndSendFrame() {
    if (!video || !localStream || video.videoWidth === 0) return;

    hiddenCanvas.width = 640;
    hiddenCanvas.height = 360;
    const ctx = hiddenCanvas.getContext('2d');
    ctx.drawImage(video, 0, 0, 640, 360);

    const base64Data = hiddenCanvas.toDataURL('image/jpeg', 0.65);
    const cameraId = cameraSelect ? cameraSelect.value : 'CAM-SC101';

    try {
      if (window.appSocket && window.appSocket.connected) {
        window.appSocket.emit('camera:stream_frame', {
          cameraId,
          frameData: base64Data,
          timestamp: Date.now()
        });
        framesSent++;
        if (framesSentEl) framesSentEl.textContent = framesSent;
      } else {
        // Fallback HTTP POST
        await fetch(`/api/cameras/${encodeURIComponent(cameraId)}/frame`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: base64Data })
        });
        framesSent++;
        if (framesSentEl) framesSentEl.textContent = framesSent;
      }
    } catch (e) {
      // ignore transient network hiccup
    }
  }

  if (snapBtn) {
    snapBtn.addEventListener('click', () => {
      captureAndSendFrame();
      window.showToast('Snapshot transmitted to security gateway', 'success');
    });
  }
});
