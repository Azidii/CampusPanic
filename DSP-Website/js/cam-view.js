/**
 * Cam View & Verification Feed Controller - cam-view.js
 */

document.addEventListener('DOMContentLoaded', () => {
  const nodeSelector = document.getElementById('camNodeSelector');
  const mainImage = document.getElementById('currentCamImage');
  const canvas = document.getElementById('detectionCanvas');

  if (nodeSelector) {
    nodeSelector.addEventListener('change', (e) => {
      const nodeId = e.target.value;
      if (nodeId) {
        window.location.href = `/cam-view?nodeId=${encodeURIComponent(nodeId)}`;
      }
    });
  }

  // Draw simulated bounding box on canvas if active threat
  function drawDetectionOverlay(firearmConfidence) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width = canvas.offsetWidth;
    const height = canvas.height = canvas.offsetHeight;

    ctx.clearRect(0, 0, width, height);

    if (firearmConfidence && firearmConfidence > 0.5) {
      // Draw red verified detection box
      const boxW = width * 0.28;
      const boxH = height * 0.45;
      const boxX = (width - boxW) / 2;
      const boxY = (height - boxH) / 2;

      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 4]);
      ctx.strokeRect(boxX, boxY, boxW, boxH);

      // Label
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(boxX, boxY - 26, boxW, 26);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px "JetBrains Mono", monospace';
      ctx.fillText(`FIREARM ${(firearmConfidence * 100).toFixed(0)}% [VERIFIED]`, boxX + 6, boxY - 8);
    }
  }

  const initialFirearmConf = parseFloat(canvas?.dataset?.firearmConf || '0');
  if (initialFirearmConf > 0) {
    drawDetectionOverlay(initialFirearmConf);
  }

  window.addEventListener('resize', () => {
    if (initialFirearmConf > 0) drawDetectionOverlay(initialFirearmConf);
  });

  // Listen for realtime camera frames via socket
  if (window.appSocket) {
    window.appSocket.on('camera:live_frame', (data) => {
      const activeCameraId = canvas?.dataset?.activeCameraId;
      if (activeCameraId && data.cameraId === activeCameraId) {
        if (mainImage) {
          mainImage.src = data.frameUrl || data.frameData;
        }
      }
    });
  }
});
