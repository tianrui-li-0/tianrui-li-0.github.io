/* The mechanical key sounds from the original terminal opening. */
(() => {
  let context = null, bus = null, noiseBuffer = null;
  let enabled = true;
  const button = document.getElementById('sound-toggle');
  function updateButton() {
    if (!button) return;
    button.textContent = !enabled ? '键盘声：关' : context?.state === 'running' ? '键盘声：开' : '点击开启键盘声';
    button.setAttribute('aria-pressed', String(enabled));
  }
  function unlock() {
    if (!enabled) return;
    try {
      if (!context) {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) { if (button) button.hidden = true; return; }
        context = new Audio();
        bus = context.createGain(); bus.gain.value = 1; bus.connect(context.destination);
        context.addEventListener('statechange', updateButton);
      }
      // Never queue sound while autoplay is blocked. Resume only future keys.
      if (context.state === 'suspended') context.resume().then(updateButton).catch(() => {});
    } catch { /* The opening remains usable if audio is unavailable. */ }
    updateButton();
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
    if (!enabled || document.hidden || context?.state !== 'running') return;
    const t = context.currentTime, j = 0.85 + Math.random() * 0.3;
    if (enter) {
      burst(t, 1500 * j, 1.2, 0.5, 0.06); burst(t, 320, 1.5, 0.45, 0.09);
      burst(t + 0.075, 2600 * j, 2, 0.16, 0.03);
    } else {
      burst(t, 3200 * j, 1.6, 0.32, 0.035); burst(t, 900 * j, 2, 0.14, 0.03);
      burst(t + 0.05 + Math.random() * 0.02, 4200 * j, 3, 0.07, 0.02);
    }
  }
  button?.addEventListener('click', () => {
    // The first click unlocks blocked audio rather than immediately muting it.
    if (enabled && context?.state !== 'running') { unlock(); return; }
    enabled = !enabled;
    if (bus) bus.gain.setTargetAtTime(enabled ? 1 : 0, context.currentTime, 0.03);
    if (enabled) { unlock(); key(); }
    updateButton();
  });
  for (const event of ['pointerdown', 'touchend']) {
    addEventListener(event, e => { if (e.target !== button) unlock(); }, { capture: true, passive: true });
  }
  window.RayAudio = { key, unlock };
  unlock();
})();
