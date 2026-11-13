let audioContext: AudioContext | null = null;

/**
 * Short alert beeps generated with Web Audio - no sound file to bundle.
 * Electron's default autoplay policy allows this without a user gesture.
 */
export function playAlertBeep(times = 3): void {
  try {
    audioContext = audioContext || new AudioContext();
    if (audioContext.state === 'suspended') void audioContext.resume();
    const ctx = audioContext;
    const start = ctx.currentTime + 0.05;
    for (let i = 0; i < times; i++) {
      const t = start + i * 0.35;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.27);
    }
  } catch (err) {
    console.warn('[alertSound] Could not play alert beep:', err);
  }
}
