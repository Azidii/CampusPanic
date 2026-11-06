/**
 * Settings Controller - settings.js
 */

document.addEventListener('DOMContentLoaded', () => {
  const resetDialog = document.getElementById('alertResetDialog');
  let confirmationToken;
  document.getElementById('reviewAlertReset')?.addEventListener('click', async event => {
    const result = document.getElementById('alertResetResult'); result.textContent = ''; event.target.disabled = true;
    try {
      const response = await fetch('/api/alerts/reset-preview', {cache:'no-store'}), data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Cannot load alert count.');
      confirmationToken = data.confirmationToken;
      document.getElementById('alertResetCount').textContent = data.count + ' alerts will be permanently deleted.';
      document.getElementById('alertResetConfirmation').value = ''; document.getElementById('alertResetError').textContent = '';
      resetDialog.showModal(); document.getElementById('cancelAlertReset').focus();
    } catch (error) { result.textContent = error.message; }
    finally { event.target.disabled = false; }
  });
  document.getElementById('cancelAlertReset')?.addEventListener('click', () => resetDialog.close());
  document.getElementById('alertResetForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = document.getElementById('confirmAlertReset'); submit.disabled = true;
    try {
      const response = await fetch('/api/alerts', {method:'DELETE', headers:{'Content-Type':'application/json','X-CampusPanic-Action':'reset-alerts'},
        body:JSON.stringify({confirmationToken,confirmation:document.getElementById('alertResetConfirmation').value})});
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Reset failed.');
      document.getElementById('alertResetResult').textContent = data.message + ' Deleted: ' + data.deleted + '. Retained: ' + data.remaining + '. Node state reconciled: ' + (data.reconciled ? 'yes' : 'no') + (data.failures?.length ? '. Failed incident IDs: ' + data.failures.map(f => f.alertId).join(', ') : '');
      resetDialog.close(); window.refreshCampus();
    } catch (error) { document.getElementById('alertResetError').textContent = error.message + ' Close this dialog and review the count before retrying.'; }
    finally { submit.disabled = false; }
  });
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
