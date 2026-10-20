/**
 * CCTV Surveillance Matrix Controller - all-cams.js
 */

document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('cameraEnlargeModal');
  const modalImg = document.getElementById('enlargeModalImg');
  const modalTitle = document.getElementById('enlargeModalTitle');
  const modalInfo = document.getElementById('enlargeModalInfo');
  const closeBtn = document.getElementById('closeEnlargeModalBtn');

  // 1. Click to Enlarge
  document.querySelectorAll('.cctv-card').forEach((card) => {
    card.addEventListener('click', () => {
      const img = card.querySelector('img');
      const label = card.dataset.label;
      const room = card.dataset.room;
      const building = card.dataset.building;
      const status = card.dataset.online === 'true' ? 'ONLINE' : 'OFFLINE';

      if (modal && modalImg) {
        modalImg.src = img ? img.src : '/uploads/alerts/placeholder_manual_alert.svg';
        modalTitle.textContent = label || `${building} - ${room}`;
        modalInfo.textContent = `Location: ${building}, ${room} | Status: ${status}`;
        modal.classList.add('active');
      }
    });
  });

  if (closeBtn && modal) {
    closeBtn.addEventListener('click', () => {
      modal.classList.remove('active');
    });
  }

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('active');
      }
    });
  }

  // 2. Realtime Frame Updates
  if (window.appSocket) {
    window.appSocket.on('camera:live_frame', (data) => {
      const card = document.getElementById(`cctv-card-${data.cameraId}`);
      if (card) {
        const img = card.querySelector('.cctv-frame-img');
        if (img) {
          img.src = data.frameUrl || data.frameData;
        }
      }
    });

    window.appSocket.on('camera:status', (data) => {
      const card = document.getElementById(`cctv-card-${data.cameraId}`);
      if (card) {
        card.dataset.online = data.online ? 'true' : 'false';
      }
    });
  }
});
