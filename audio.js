/**
 * Rainy Stay's original, synthesized soundscape. No samples or network requests.
 * Call setEnabled(true) synchronously from a click/tap; never from a timer.
 * Visibility/interruption pauses are deliberate: a new gesture resumes sound.
 */
const VIEWS = Object.freeze({
  bed:    { rain: 0.76, rainPan: 0.08, rainCutoff: 3400, tv: 0.36, tvPan: -0.86, tvCutoff: 1900 },
  window: { rain: 1.12, rainPan: -0.12, rainCutoff: 7000, tv: 0.16, tvPan: -0.72, tvCutoff: 1100 },
  sofa:   { rain: 0.54, rainPan: 0.64, rainCutoff: 2300, tv: 0.96, tvPan: -0.24, tvCutoff: 4900 },
  table:  { rain: 0.82, rainPan: 0.06, rainCutoff: 4200, tv: 0.32, tvPan: -0.66, tvCutoff: 1650 },
});

const CHORDS = [
  [130.8128, 195.9977, 293.6648],
  [110, 164.8138, 261.6256],
  [146.8324, 220, 329.6276],
  [97.9989, 146.8324, 246.9417],
];
const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const rand = (low, high) => low + Math.random() * (high - low);

async function bounded(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(message);
          error.name = 'TimeoutError';
          reject(error);
        }, milliseconds);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

function smooth(param, value, now, time = 0.22) {
  // cancelAndHoldAtTime avoids a discontinuity during fast slider drags. The
  // fallback is needed by older Safari versions.
  if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(now);
  else {
    const current = param.value;
    param.cancelScheduledValues(now);
    param.setValueAtTime(current, now);
  }
  param.setTargetAtTime(value, now, time);
}

export class RainyAudio {
  constructor({ onState } = {}) {
    this._onState = typeof onState === 'function' ? onState : () => {};
    this._Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    this._ctx = null;
    this._graphReady = false;
    this._enabled = false;
    this._playing = false;
    this._starting = false;
    this._needsGesture = false;
    this._hidden = Boolean(globalThis.document?.hidden);
    this._destroyed = false;
    this._error = null;
    this._errorCode = null;
    this._epoch = 0;
    this._scheduler = null;
    this._sources = new Set();
    this._transients = new Set();
    this._nodes = [];
    this._chordIndex = 0;
    this._settings = {
      scene: 'bed', rain: 0.72, tv: 0.32, master: 0.72,
      curtainsClosed: false, tvOn: true, windowOpen: false,
    };
    this._contextChanged = () => this._handleContextState();
    this._visibilityChanged = () => this.handleVisibility(Boolean(globalThis.document?.hidden));
    this._pageHidden = () => this.handleVisibility(true);
    this._pageShown = () => this.handleVisibility(Boolean(globalThis.document?.hidden));
    globalThis.document?.addEventListener?.('visibilitychange', this._visibilityChanged);
    globalThis.addEventListener?.('pagehide', this._pageHidden);
    globalThis.addEventListener?.('pageshow', this._pageShown);
    this._emit();
  }

  getState() {
    let status = 'off';
    if (this._destroyed) status = 'destroyed';
    else if (!this._Context) status = 'unsupported';
    else if (this._error) status = 'error';
    else if (this._starting) status = 'starting';
    else if (this._playing && this._ctx?.state === 'running') status = 'playing';
    else if (this._enabled && this._ctx?.state === 'interrupted') status = 'interrupted';
    else if (this._enabled) status = 'paused';
    return {
      enabled: this._enabled,
      playing: status === 'playing',
      status,
      supported: Boolean(this._Context),
      needsGesture: this._needsGesture,
      hidden: this._hidden,
      contextState: this._ctx?.state || 'uninitialized',
      error: this._error,
      errorCode: this._errorCode,
      settings: { ...this._settings },
    };
  }

  _emit() {
    try { this._onState(this.getState()); } catch { /* UI must not break audio cleanup. */ }
  }

  async setEnabled(enabled) {
    if (this._destroyed) return this.getState();
    const epoch = ++this._epoch;
    this._enabled = Boolean(enabled);
    this._error = null;
    this._errorCode = null;
    if (!this._enabled) {
      this._needsGesture = false;
      this._starting = false;
      this._playing = false;
      this._stopScheduler();
      this._emit();
      await this._quietAndSuspend(epoch);
      this._emit();
      return this.getState();
    }
    if (!this._Context) {
      this._needsGesture = false;
      this._error = 'This browser does not support Web Audio.';
      this._errorCode = 'unsupported';
      this._emit();
      return this.getState();
    }
    if (this._hidden) {
      this._needsGesture = true;
      this._emit();
      return this.getState();
    }
    if (this._playing && this._ctx?.state === 'running') return this.getState();
    // Where the browser exposes activation, enforce the public gesture contract.
    // Older Safari has no userActivation API; resume() remains its authority.
    if (globalThis.navigator?.userActivation?.isActive === false) {
      this._needsGesture = true;
      this._error = 'Tap the sound button to start or resume audio.';
      this._errorCode = 'gesture-required';
      this._emit();
      return this.getState();
    }
    this._usePlaybackSession();
    this._starting = true;
    this._needsGesture = false;
    this._emit();
    try {
      if (!this._ctx) this._buildGraph();
      if (!this._graphReady) throw new Error('The audio engine could not initialize. Reload to try again.');
      if (this._ctx.state === 'closed') throw new Error('The browser closed the audio session. Reload to start a new session.');
      // Called before the first await so Safari receives the initiating gesture.
      if (this._ctx.state !== 'running') {
        await bounded(this._ctx.resume(), 4500, 'The browser has paused audio. Tap the sound button to try again.');
      }
      if (epoch !== this._epoch || this._destroyed || !this._enabled || this._hidden) return this.getState();
      this._starting = false;
      if (this._ctx.state !== 'running') {
        this._needsGesture = true;
        this._playing = false;
      } else {
        this._playing = true;
        this._needsGesture = false;
        this._applySettings();
        smooth(this._gate.gain, 1, this._ctx.currentTime, 0.12);
        this._startScheduler();
      }
    } catch (error) {
      if (epoch !== this._epoch || this._destroyed) return this.getState();
      this._starting = false;
      this._playing = false;
      this._needsGesture = true;
      this._errorCode = error?.name === 'NotAllowedError' ? 'gesture-required' : error?.name === 'TimeoutError' ? 'resume-timeout' : 'audio-error';
      this._error = error?.message || 'Audio could not start. Tap to try again.';
      this._stopScheduler();
      if (this._gate) {
        this._gate.gain.cancelScheduledValues(this._ctx.currentTime);
        this._gate.gain.setValueAtTime(0, this._ctx.currentTime);
      }
      if (this._ctx?.state === 'running') void this._ctx.suspend().catch(() => {});
    }
    this._emit();
    return this.getState();
  }

  update(next = {}) {
    if (this._destroyed) return this.getState();
    const hadTV = this._settings.tvOn && this._settings.tv > 0;
    if (Object.prototype.hasOwnProperty.call(VIEWS, next.scene)) this._settings.scene = next.scene;
    for (const key of ['rain', 'tv', 'master']) {
      if (typeof next[key] === 'number' && Number.isFinite(next[key])) this._settings[key] = clamp(next[key]);
    }
    for (const key of ['curtainsClosed', 'tvOn', 'windowOpen']) {
      if (typeof next[key] === 'boolean') this._settings[key] = next[key];
    }
    if (this._ctx && this._ctx.state !== 'closed' && this._gate) this._applySettings();
    if (this._playing && !hadTV && this._settings.tvOn && this._settings.tv > 0) {
      this._nextChord = this._ctx.currentTime + 0.08;
      this._nextNote = this._ctx.currentTime + 2.5;
    }
    this._emit();
    return this.getState();
  }

  async handleVisibility(hidden) {
    if (this._destroyed || this._hidden === Boolean(hidden)) return this.getState();
    this._hidden = Boolean(hidden);
    if (this._hidden) {
      const epoch = ++this._epoch;
      this._starting = false;
      this._playing = false;
      this._needsGesture = this._enabled;
      this._stopScheduler();
      // Mute immediately before timers are throttled in a background tab.
      if (this._gate) {
        this._gate.gain.cancelScheduledValues(this._ctx.currentTime);
        this._gate.gain.setValueAtTime(0, this._ctx.currentTime);
      }
      this._emit();
      await this._quietAndSuspend(epoch, true);
    }
    // Never call resume() from visibilitychange/pageshow.
    this._emit();
    return this.getState();
  }

  async destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    ++this._epoch;
    this._enabled = false;
    this._playing = false;
    this._starting = false;
    this._needsGesture = false;
    this._stopScheduler();
    globalThis.document?.removeEventListener?.('visibilitychange', this._visibilityChanged);
    globalThis.removeEventListener?.('pagehide', this._pageHidden);
    globalThis.removeEventListener?.('pageshow', this._pageShown);
    this._ctx?.removeEventListener?.('statechange', this._contextChanged);
    if (this._ctx && !this._ctx.removeEventListener) this._ctx.onstatechange = null;
    for (const source of this._sources) { try { source.stop(); } catch { /* Already stopped. */ } }
    for (const node of this._nodes) { try { node.disconnect(); } catch { /* Already detached. */ } }
    this._sources.clear();
    this._transients.clear();
    this._nodes.length = 0;
    try { if (this._ctx && this._ctx.state !== 'closed') await this._ctx.close(); } catch { /* Disposal remains final. */ }
    this._emit();
  }

  _usePlaybackSession() {
    try {
      if (globalThis.navigator?.audioSession) globalThis.navigator.audioSession.type = 'playback';
    } catch { /* Experimental on some browsers; ordinary Web Audio still works. */ }
  }

  _handleContextState() {
    if (this._destroyed || this._starting) return;
    const contextState = this._ctx.state;
    if (contextState !== 'running') {
      this._playing = false;
      this._stopScheduler();
      this._clearTransients();
      if (this._enabled) this._needsGesture = true;
      if (this._gate) {
        this._gate.gain.cancelScheduledValues(this._ctx.currentTime);
        this._gate.gain.setValueAtTime(0, this._ctx.currentTime);
      }
      if (contextState === 'closed') {
        this._error = 'The browser closed the audio session. Reload to start a new session.';
        this._errorCode = 'context-closed';
      }
    } else if (!this._playing || !this._enabled || this._hidden || this._needsGesture) {
      // Some platforms automatically restore interrupted contexts. The gate is
      // already silent; keep it that way until the user explicitly resumes.
      this._gate.gain.cancelScheduledValues(this._ctx.currentTime);
      this._gate.gain.setValueAtTime(0, this._ctx.currentTime);
      void this._ctx.suspend().catch(() => {});
    }
    this._emit();
  }

  async _quietAndSuspend(epoch, immediate = false) {
    if (!this._ctx || this._ctx.state === 'closed') return;
    const now = this._ctx.currentTime;
    if (this._gate) {
      if (immediate) this._gate.gain.setValueAtTime(0, now);
      else smooth(this._gate.gain, 0, now, 0.01);
    }
    if (!immediate && this._ctx.state === 'running') await new Promise(resolve => setTimeout(resolve, 55));
    if (epoch !== this._epoch || this._destroyed) return;
    this._clearTransients();
    try {
      if (this._ctx.state !== 'suspended') {
        await bounded(this._ctx.suspend(), 2000, 'Audio is muted, but the browser did not confirm pausing.');
      }
    }
    catch (error) {
      if (epoch === this._epoch) {
        this._error = error?.message || 'The audio session could not pause.';
        this._errorCode = 'pause-error';
      }
    }
  }

  _node(node) { this._nodes.push(node); return node; }

  _panner(pan = 0) {
    const node = this._ctx.createStereoPanner?.();
    if (node) {
      node.pan.value = pan;
      return this._node(node);
    }
    // The fallback preserves distance/filter changes on old WebKit.
    return this._node(this._ctx.createGain());
  }

  _buildGraph() {
    const ctx = this._ctx = new this._Context({ latencyHint: 'playback' });
    if (ctx.addEventListener) ctx.addEventListener('statechange', this._contextChanged);
    else ctx.onstatechange = this._contextChanged;
    this._gate = this._node(ctx.createGain());
    this._gate.gain.value = 0;
    this._master = this._node(ctx.createGain());
    const limiter = this._node(ctx.createDynamicsCompressor());
    limiter.threshold.value = -15;
    limiter.knee.value = 18;
    limiter.ratio.value = 3;
    limiter.attack.value = 0.008;
    limiter.release.value = 0.3;
    this._master.connect(limiter).connect(this._gate).connect(ctx.destination);

    this._rainFilter = this._node(ctx.createBiquadFilter());
    this._rainFilter.type = 'lowpass';
    this._rainFilter.Q.value = 0.45;
    this._rainGain = this._node(ctx.createGain());
    this._rainPan = this._panner();
    this._rainFilter.connect(this._rainGain).connect(this._rainPan).connect(this._master);
    this._rainLayers = [];
    const layers = [
      { duration: 13.37, color: 'brown', type: 'lowpass', cutoff: 640, gain: 0.57, pan: -0.35 },
      { duration: 17.73, color: 'pink', type: 'bandpass', cutoff: 1450, gain: 0.42, pan: 0.28 },
      { duration: 23.11, color: 'white', type: 'highpass', cutoff: 2500, gain: 0.21, pan: -0.10 },
    ];
    for (const layer of layers) {
      const source = this._node(ctx.createBufferSource());
      source.buffer = this._noiseBuffer(layer.duration, layer.color, true);
      source.loop = true;
      source.loopStart = 0.18;
      source.loopEnd = source.buffer.duration;
      const filter = this._node(ctx.createBiquadFilter());
      filter.type = layer.type;
      filter.frequency.value = layer.cutoff;
      filter.Q.value = 0.5;
      const gain = this._node(ctx.createGain());
      gain.gain.value = layer.gain;
      const pan = this._panner(layer.pan);
      source.connect(filter).connect(gain).connect(pan).connect(this._rainFilter);
      source.start(0, rand(0.3, source.buffer.duration - 1));
      this._sources.add(source);
      this._rainLayers.push({ gain, pan, base: layer.gain, spread: layer.pan });
    }
    this._dropBuffers = Array.from({ length: 4 }, () => {
      const buffer = this._noiseBuffer(rand(0.065, 0.13), 'white');
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const u = i / data.length;
        data[i] *= Math.min(1, u * 45) * Math.exp(-u * 6.8);
      }
      return buffer;
    });

    this._tvFilter = this._node(ctx.createBiquadFilter());
    this._tvFilter.type = 'lowpass';
    this._tvFilter.Q.value = 0.45;
    this._tvGain = this._node(ctx.createGain());
    this._tvPan = this._panner();
    this._tvFilter.connect(this._tvGain).connect(this._tvPan).connect(this._master);
    // A small synthesized stereo room makes the TV program soft and distant.
    const reverb = this._node(ctx.createConvolver());
    const impulse = ctx.createBuffer(2, Math.ceil(ctx.sampleRate * 1.45), ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3.2) * 0.16;
    }
    reverb.buffer = impulse;
    const wet = this._node(ctx.createGain());
    wet.gain.value = 0.18;
    this._tvFilter.connect(reverb).connect(wet).connect(this._tvGain);
    this._applySettings();
    this._graphReady = true;
  }

  _noiseBuffer(seconds, color, seamless = false) {
    const ctx = this._ctx;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let brown = 0, p0 = 0, p1 = 0, p2 = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      if (color === 'brown') {
        brown = (brown + white * 0.035) / 1.025;
        data[i] = brown * 3.9;
      } else if (color === 'pink') {
        p0 = p0 * 0.99765 + white * 0.099046;
        p1 = p1 * 0.963 + white * 0.2965164;
        p2 = p2 * 0.57 + white * 1.0526913;
        data[i] = (p0 + p1 + p2 + white * 0.1848) * 0.18;
      } else data[i] = white * 0.7;
    }
    if (seamless) {
      // Crossfade the tail into the first 180 ms, then loop from 180 ms.
      // Independent long lengths + wandering layer gains avoid a short repeat.
      const overlap = Math.floor(ctx.sampleRate * 0.18);
      for (let i = 0; i < overlap; i++) {
        const mix = (1 - Math.cos(Math.PI * i / overlap)) / 2;
        const end = data.length - overlap + i;
        data[end] = data[end] * (1 - mix) + data[i] * mix;
      }
    }
    return buffer;
  }

  _applySettings() {
    const s = this._settings;
    const view = VIEWS[s.scene];
    const now = this._ctx.currentTime;
    const open = s.windowOpen ? 1.23 : 1;
    const curtain = s.curtainsClosed ? 0.68 : 1;
    smooth(this._master.gain, Math.pow(s.master, 1.45) * 0.8, now);
    smooth(this._rainGain.gain, Math.pow(s.rain, 1.5) * view.rain * open * curtain, now);
    smooth(this._rainFilter.frequency, clamp(view.rainCutoff * (s.windowOpen ? 1.45 : 1) * (s.curtainsClosed ? 0.43 : 1), 500, 11000), now, 0.38);
    if (this._rainPan.pan) smooth(this._rainPan.pan, view.rainPan, now, 0.38);
    smooth(this._tvGain.gain, s.tvOn ? Math.pow(s.tv, 1.4) * view.tv : 0, now, 0.09);
    smooth(this._tvFilter.frequency, view.tvCutoff, now, 0.4);
    if (this._tvPan.pan) smooth(this._tvPan.pan, view.tvPan, now, 0.4);
  }

  _startScheduler() {
    this._stopScheduler();
    this._clearTransients();
    const now = this._ctx.currentTime;
    this._nextDrop = now + 0.1;
    this._nextChord = now + 0.06;
    this._nextNote = now + 2.5;
    this._nextSwell = now + 0.1;
    this._safeSchedule();
    if (this._playing) this._scheduler = setInterval(() => this._safeSchedule(), 180);
  }

  _stopScheduler() {
    if (this._scheduler !== null) clearInterval(this._scheduler);
    this._scheduler = null;
  }

  _safeSchedule() {
    try { this._schedule(); }
    catch (error) {
      this._playing = false;
      this._needsGesture = true;
      this._error = error?.message || 'Audio was interrupted. Tap to try again.';
      this._errorCode = 'synthesis-error';
      this._stopScheduler();
      this._gate.gain.cancelScheduledValues(this._ctx.currentTime);
      this._gate.gain.setValueAtTime(0, this._ctx.currentTime);
      this._clearTransients();
      if (this._ctx.state === 'running') void this._ctx.suspend().catch(() => {});
      this._emit();
    }
  }

  _schedule() {
    if (!this._playing || !this._enabled || this._hidden || this._ctx.state !== 'running') return;
    const now = this._ctx.currentTime;
    // Do not replay a backlog if a busy frame or device sleep delayed the timer.
    this._nextDrop = Math.max(this._nextDrop, now + 0.015);
    this._nextChord = Math.max(this._nextChord, now + 0.015);
    this._nextNote = Math.max(this._nextNote, now + 0.015);
    const horizon = now + 0.65;
    const s = this._settings;
    while (this._nextDrop < horizon) {
      if (s.rain > 0 && s.master > 0) this._drop(this._nextDrop);
      const density = (s.scene === 'window' ? 9 : 5.5) * (0.6 + s.rain * 0.65);
      this._nextDrop += rand(0.35, 1.65) / density;
    }
    if (this._nextChord < horizon) {
      if (s.tvOn && s.tv > 0 && s.master > 0) this._chord(this._nextChord);
      this._nextChord += rand(7.8, 10.2);
    }
    if (this._nextNote < horizon) {
      if (s.tvOn && s.tv > 0 && s.master > 0) this._softNote(this._nextNote);
      this._nextNote += rand(3.2, 6.5);
    }
    if (now >= this._nextSwell) {
      for (const layer of this._rainLayers) {
        smooth(layer.gain.gain, layer.base * rand(0.78, 1.17), now, rand(1.8, 4));
        if (layer.pan.pan) smooth(layer.pan.pan, clamp(layer.spread + rand(-0.12, 0.12), -1, 1), now, 2.4);
      }
      this._nextSwell = now + rand(3.5, 6.5);
    }
  }

  _trackTransient(sources, nodes) {
    const record = { sources, nodes };
    this._transients.add(record);
    let remaining = sources.length;
    for (const source of sources) {
      this._sources.add(source);
      source.onended = () => {
        this._sources.delete(source);
        if (--remaining === 0) {
          for (const node of nodes) { try { node.disconnect(); } catch { /* Disposed. */ } }
          this._transients.delete(record);
        }
      };
    }
  }

  _clearTransients() {
    for (const record of this._transients) {
      for (const source of record.sources) {
        try { source.stop(); } catch { /* Already ended. */ }
        this._sources.delete(source);
      }
      for (const node of record.nodes) { try { node.disconnect(); } catch { /* Already detached. */ } }
    }
    this._transients.clear();
  }

  _drop(time) {
    const ctx = this._ctx;
    const source = ctx.createBufferSource();
    source.buffer = this._dropBuffers[Math.floor(Math.random() * this._dropBuffers.length)];
    source.playbackRate.value = rand(0.75, 1.5);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = rand(1000, 4600);
    filter.Q.value = rand(0.7, 2.4);
    const gain = ctx.createGain();
    gain.gain.value = rand(0.028, 0.095);
    const pan = ctx.createStereoPanner?.() || ctx.createGain();
    if (pan.pan) pan.pan.value = rand(-0.85, 0.85);
    source.connect(filter).connect(gain).connect(pan).connect(this._rainFilter);
    this._trackTransient([source], [source, filter, gain, pan]);
    source.start(time);
    source.stop(time + source.buffer.duration / source.playbackRate.value + 0.02);
  }

  _chord(time) {
    const ctx = this._ctx;
    const notes = CHORDS[this._chordIndex++ % CHORDS.length];
    const duration = rand(10.5, 12.8);
    for (let i = 0; i < notes.length; i++) {
      const osc = ctx.createOscillator();
      osc.type = i === 1 ? 'triangle' : 'sine';
      osc.frequency.value = notes[i];
      osc.detune.value = rand(-3.5, 3.5);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(i === 0 ? 0.115 : 0.069, time + 2.3 + i * 0.2);
      gain.gain.linearRampToValueAtTime(0.042, time + duration * 0.68);
      gain.gain.linearRampToValueAtTime(0, time + duration);
      osc.connect(gain).connect(this._tvFilter);
      this._trackTransient([osc], [osc, gain]);
      osc.start(time);
      osc.stop(time + duration + 0.04);
    }
  }

  _softNote(time) {
    const ctx = this._ctx;
    const pitches = [391.9954, 440, 523.2511, 587.3295, 659.2551];
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = pitches[Math.floor(Math.random() * pitches.length)];
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(rand(0.042, 0.066), time + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 3.3);
    gain.gain.linearRampToValueAtTime(0, time + 3.4);
    osc.connect(gain).connect(this._tvFilter);
    this._trackTransient([osc], [osc, gain]);
    osc.start(time);
    osc.stop(time + 3.45);
  }
}
