/**
 * Web Audio API Alert Synthesizer
 * Generates immediate, crisp emergency siren and alert tones without external audio file dependencies.
 */

let audioCtx = null;

const getAudioContext = () => {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      audioCtx = new AudioContext();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
};

/**
 * Play high-urgency two-tone alarm for Verified Gunshot Threats
 */
export const playVerifiedThreatAlarm = (volume = 0.8) => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    gain.gain.setValueAtTime(volume * 0.25, ctx.currentTime);

    // Two-tone alternating emergency siren
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(880, now); // A5
    osc.frequency.setValueAtTime(659.25, now + 0.25); // E5
    osc.frequency.setValueAtTime(880, now + 0.5);
    osc.frequency.setValueAtTime(659.25, now + 0.75);
    osc.frequency.setValueAtTime(880, now + 1.0);
    osc.frequency.setValueAtTime(659.25, now + 1.25);

    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 1.5);
  } catch (err) {
    console.warn('[Sound] Audio play failed:', err.message);
  }
};

/**
 * Play standard chime for manual alerts and warnings
 */
export const playWarningChime = (volume = 0.5) => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    gain.gain.setValueAtTime(volume * 0.2, ctx.currentTime);

    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(587.33, now); // D5
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.15); // A5

    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.6);
  } catch (err) {
    console.warn('[Sound] Audio chime failed:', err.message);
  }
};
