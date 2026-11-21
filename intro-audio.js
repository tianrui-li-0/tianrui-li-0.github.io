/* The mechanical key sounds from the original terminal opening. */
(() => {
  let context = null, bus = null, noiseBuffer = null;
  function unlock() {
    try {
      if (!context) {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) return;
        context = new Audio();
        bus = context.createGain(); bus.gain.value = 1; bus.connect(context.destination);
      }
      // Never queue sound while autoplay is blocked. Resume only future keys.
      if (context.state === 'suspended') context.resume().catch(() => {});
    } catch { /* The opening remains usable if audio is unavailable. */ }
  }
  function burst(t, frequency, q, volume, duration) {
    if (!noiseBuffer) {
      noiseBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    const source = context.createBufferSource(), filter = context.createBiquadFilter(), gain = context.createGain();
    source.buffer = noiseBuffer;
    filter.type = 'bandpass'; filter.frequency.value = frequency; filter.Q.value = q;
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    source.connect(filter).connect(gain).connect(bus);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
    source.start(t, Math.random() * 1.5); source.stop(t + duration + 0.02);
  }
  function key(enter = false) {
    if (document.hidden || context?.state !== 'running') return;
    const t = context.currentTime, j = 0.85 + Math.random() * 0.3;
    if (enter) {
      burst(t, 1500 * j, 1.2, 0.5, 0.06); burst(t, 320, 1.5, 0.45, 0.09);
      burst(t + 0.075, 2600 * j, 2, 0.16, 0.03);
    } else {
      burst(t, 3200 * j, 1.6, 0.32, 0.035); burst(t, 900 * j, 2, 0.14, 0.03);
      burst(t + 0.05 + Math.random() * 0.02, 4200 * j, 3, 0.07, 0.02);
    }
  }
  // Audio is on by default; an ordinary interaction unlocks it if the browser requires one.
  for (const event of ['pointerdown', 'touchend', 'click']) {
    addEventListener(event, unlock, { capture: true, passive: true });
  }
  window.RayAudio = { key, unlock };
  unlock();
})();
