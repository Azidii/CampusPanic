/**
 * Settings Controller - settings.js
 */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Theme Selection Cards
  const currentTheme = localStorage.getItem('cp_theme') || 'dark';
  document.querySelectorAll('.theme-card').forEach((card) => {
    if (card.dataset.themeVal === currentTheme) {
      card.classList.add('active');
    }
    card.addEventListener('click', () => {
      window.setTheme(card.dataset.themeVal);
    });
  });

  // 2. Alert Sound Toggle
  const soundToggle = document.getElementById('soundToggleInput');
  if (soundToggle) {
    const isSoundEnabled = localStorage.getItem('cp_sound_enabled') !== 'false';
    soundToggle.checked = isSoundEnabled;
    soundToggle.addEventListener('change', (e) => {
      localStorage.setItem('cp_sound_enabled', e.target.checked ? 'true' : 'false');
      window.showToast(e.target.checked ? 'Alert sound enabled' : 'Alert sound muted', 'info');
    });
  }

  // 3. Volume Slider
  const volumeSlider = document.getElementById('volumeSlider');
  const volumeValText = document.getElementById('volumeValText');
  if (volumeSlider) {
    const savedVol = localStorage.getItem('cp_sound_volume') || '0.8';
    volumeSlider.value = savedVol;
    if (volumeValText) volumeValText.textContent = `${Math.round(savedVol * 100)}%`;

    volumeSlider.addEventListener('input', (e) => {
      const vol = e.target.value;
      localStorage.setItem('cp_sound_volume', vol);
      if (volumeValText) volumeValText.textContent = `${Math.round(vol * 100)}%`;
    });
  }

  // 4. Test Alarm Sound Button
  const testAlarmBtn = document.getElementById('testAlarmSoundBtn');
  if (testAlarmBtn) {
    testAlarmBtn.addEventListener('click', () => {
      if (window.alarmSound) {
        window.alarmSound.playAlarm(2500);
        window.showToast('Testing emergency siren synthesizer...', 'warning');
      }
    });
  }
});
