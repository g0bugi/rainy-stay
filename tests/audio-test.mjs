// Unit tests for lifecycle and graph behavior. No speakers/browser required.
// Run: node tests/audio-test.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  emit(type) { for (const fn of [...(this.listeners.get(type) || [])]) fn(); }
}

class Param {
  constructor(value = 0) { this.value = value; this.events = []; }
  setValueAtTime(value, time) { this.value = value; this.events.push(['set', value, time]); return this; }
  setTargetAtTime(value, time, constant) { this.value = value; this.events.push(['target', value, time, constant]); return this; }
  linearRampToValueAtTime(value, time) { this.value = value; this.events.push(['linear', value, time]); return this; }
  exponentialRampToValueAtTime(value, time) { this.value = value; this.events.push(['exponential', value, time]); return this; }
  cancelScheduledValues(time) { this.events.push(['cancel', time]); return this; }
  cancelAndHoldAtTime(time) { this.events.push(['hold', time]); return this; }
}

class Node {
  constructor(kind) {
    this.kind = kind;
    this.connections = [];
    for (const key of ['gain', 'pan', 'frequency', 'Q', 'detune', 'threshold', 'knee', 'ratio', 'attack', 'release']) this[key] = new Param();
    this.playbackRate = new Param(1);
  }
  connect(node) { this.connections.push(node); return node; }
  disconnect() { this.connections.length = 0; }
  start(time, offset) { this.started = { time, offset }; }
  stop(time) {
    this.stopped = time ?? 0;
    if (time === undefined) this.onended?.();
  }
}

class FakeContext extends Events {
  static instances = [];
  constructor() {
    super();
    this.sampleRate = 8000;
    this.currentTime = 0;
    this.state = 'suspended';
    this.nodes = [];
    this.destination = new Node('destination');
    this.resumeCount = 0;
    this.suspendCount = 0;
    FakeContext.instances.push(this);
  }
  node(kind) { const node = new Node(kind); this.nodes.push(node); return node; }
  createGain() { return this.node('gain'); }
  createBiquadFilter() { return this.node('filter'); }
  createStereoPanner() { return this.node('panner'); }
  createDynamicsCompressor() { return this.node('compressor'); }
  createBufferSource() { return this.node('buffer-source'); }
  createOscillator() { return this.node('oscillator'); }
  createConvolver() { return this.node('convolver'); }
  createBuffer(channels, frames, rate) {
    const data = Array.from({ length: channels }, () => new Float32Array(frames));
    return { numberOfChannels: channels, duration: frames / rate, length: frames, getChannelData: channel => data[channel] };
  }
  async resume() {
    this.resumeCount++;
    if (this.resumeFailure) throw this.resumeFailure;
    if (this.resumeGate) await this.resumeGate;
    this.state = 'running';
    this.emit('statechange');
  }
  async suspend() {
    this.suspendCount++;
    this.state = 'suspended';
    this.emit('statechange');
  }
  async close() { this.state = 'closed'; this.emit('statechange'); }
  interrupt() { this.state = 'interrupted'; this.emit('statechange'); }
}

const documentEvents = new Events();
documentEvents.hidden = false;
globalThis.document = documentEvents;
const pageEvents = new Events();
globalThis.addEventListener = pageEvents.addEventListener.bind(pageEvents);
globalThis.removeEventListener = pageEvents.removeEventListener.bind(pageEvents);
const navigatorStub = { userActivation: { isActive: true }, audioSession: { type: 'auto' } };
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: navigatorStub });
globalThis.AudioContext = FakeContext;
const code = await readFile(new URL('../audio.js', import.meta.url), 'utf8');
const { RainyAudio } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
let checks = 0;
const check = (label, fn) => { fn(); checks++; console.log(`PASS ${label}`); };

const observed = [];
const engine = new RainyAudio({ onState: state => observed.push(state) });
check('default is off and does not create a context', () => {
  assert.equal(engine.getState().status, 'off');
  assert.equal(engine.getState().enabled, false);
  assert.equal(FakeContext.instances.length, 0);
});
engine.update({ scene: 'sofa', rain: 2, tv: -1, master: NaN, tvOn: false });
check('updates clamp valid numbers, ignore NaN, and never autoplay', () => {
  assert.equal(engine.getState().settings.rain, 1);
  assert.equal(engine.getState().settings.tv, 0);
  assert.equal(engine.getState().settings.master, 0.72);
  assert.equal(FakeContext.instances.length, 0);
});
navigatorStub.userActivation.isActive = false;
await engine.setEnabled(true);
check('requires a gesture before constructing audio', () => {
  assert.equal(engine.getState().errorCode, 'gesture-required');
  assert.equal(engine.getState().needsGesture, true);
  assert.equal(FakeContext.instances.length, 0);
});
navigatorStub.userActivation.isActive = true;
engine.update({ rain: 0.72, tv: 0.32, tvOn: true });
await engine.setEnabled(true);
const ctx = FakeContext.instances[0];
check('explicit start creates one context and configures iPhone playback', () => {
  assert.equal(engine.getState().playing, true);
  assert.equal(navigatorStub.audioSession.type, 'playback');
  assert.equal(FakeContext.instances.length, 1);
  assert.equal(ctx.resumeCount, 1);
});
check('rain has three distinct seamless long buffers and stochastic droplets', () => {
  const loops = ctx.nodes.filter(n => n.kind === 'buffer-source' && n.loop);
  assert.equal(loops.length, 3);
  assert.ok(loops.every(n => n.buffer.duration > 13 && n.loopStart === 0.18));
  assert.equal(new Set(loops.map(n => n.buffer.duration)).size, 3);
  assert.ok(ctx.nodes.some(n => n.kind === 'buffer-source' && !n.loop));
  for (const source of loops) {
    const values = source.buffer.getChannelData(0);
    assert.ok(values.every(Number.isFinite));
    const rms = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
    assert.ok(rms > 0.05 && rms < 0.6, `noise RMS ${rms} is bounded and audible`);
  }
});
check('TV generates multiple musical voices rather than a fixed 185Hz tone', () => {
  const tones = ctx.nodes.filter(n => n.kind === 'oscillator');
  assert.equal(tones.length, 3);
  assert.equal(new Set(tones.map(n => n.frequency.value)).size, 3);
  assert.ok(tones.every(n => n.frequency.value !== 185));
});
engine.update({ scene: 'sofa' });
const sofa = { rain: engine._rainGain.gain.value, tv: engine._tvGain.gain.value, pan: engine._rainPan.pan.value };
engine.update({ scene: 'window' });
const windowCutoff = engine._rainFilter.frequency.value;
check('viewpoint changes position, distance, and tone', () => {
  assert.ok(engine._rainGain.gain.value > sofa.rain);
  assert.ok(engine._tvGain.gain.value < sofa.tv);
  assert.notEqual(engine._rainPan.pan.value, sofa.pan);
});
const openRain = engine._rainGain.gain.value;
engine.update({ windowOpen: true });
check('opening the window raises rain presence and brightness', () => {
  assert.ok(engine._rainGain.gain.value > openRain);
  assert.ok(engine._rainFilter.frequency.value > windowCutoff);
});
engine.update({ windowOpen: false });
engine.update({ curtainsClosed: true });
check('closed curtains muffle and attenuate rain', () => {
  assert.ok(engine._rainFilter.frequency.value < windowCutoff);
  assert.ok(engine._rainGain.gain.value < openRain);
});
engine.update({ tvOn: false });
check('TV off mutes the entire TV path including reverb', () => assert.equal(engine._tvGain.gain.value, 0));
engine.update({ tvOn: true });
check('re-enabling TV schedules a prompt new phrase', () => assert.ok(engine._nextChord < ctx.currentTime + 0.2));
await engine.setEnabled(false);
check('off suspends, stops the scheduler, and clears transient sources', () => {
  assert.equal(engine.getState().status, 'off');
  assert.equal(ctx.state, 'suspended');
  assert.equal(engine._scheduler, null);
  assert.equal(engine._transients.size, 0);
  assert.equal(engine._gate.gain.value, 0);
});
await engine.setEnabled(true);
check('resume reuses the same audio context', () => {
  assert.equal(FakeContext.instances.length, 1);
  assert.equal(engine.getState().playing, true);
});
await engine.handleVisibility(true);
const resumesBeforeVisible = ctx.resumeCount;
await engine.handleVisibility(false);
check('returning from background requires a tap and never auto-resumes', () => {
  assert.equal(engine.getState().enabled, true);
  assert.equal(engine.getState().status, 'paused');
  assert.equal(engine.getState().needsGesture, true);
  assert.equal(ctx.resumeCount, resumesBeforeVisible);
  assert.equal(engine._gate.gain.value, 0);
});
await engine.setEnabled(true);
ctx.interrupt();
check('interruption gates audio, clears notes, and reports need for a gesture', () => {
  assert.equal(engine.getState().status, 'interrupted');
  assert.equal(engine.getState().needsGesture, true);
  assert.equal(engine._transients.size, 0);
  assert.equal(engine._gate.gain.value, 0);
});
ctx.state = 'running';
ctx.emit('statechange');
check('browser-initiated restoration remains silent', () => {
  assert.equal(ctx.state, 'suspended');
  assert.equal(engine.getState().playing, false);
  assert.equal(engine._gate.gain.value, 0);
});
await engine.setEnabled(true);
const turningOff = engine.setEnabled(false);
await engine.setEnabled(true);
await turningOff;
check('rapid off/on cannot let a stale pause suspend new playback', () => {
  assert.equal(ctx.state, 'running');
  assert.equal(engine.getState().playing, true);
});
await engine.setEnabled(false);
ctx.resumeFailure = Object.assign(new Error('Tap again'), { name: 'NotAllowedError' });
await engine.setEnabled(true);
check('resume rejection is recoverable and accurately reported', () => {
  assert.equal(engine.getState().errorCode, 'gesture-required');
  assert.equal(engine.getState().playing, false);
  assert.equal(engine.getState().needsGesture, true);
});
ctx.resumeFailure = null;
await engine.setEnabled(true);
check('a new explicit gesture clears an earlier audio error', () => {
  assert.equal(engine.getState().error, null);
  assert.equal(engine.getState().playing, true);
});
await engine.setEnabled(false);
let releaseResume;
ctx.resumeGate = new Promise(resolve => { releaseResume = resolve; });
const pendingStart = engine.setEnabled(true);
await engine.setEnabled(false);
releaseResume();
await pendingStart;
ctx.resumeGate = null;
check('canceling an unresolved resume prevents late autoplay', () => {
  assert.equal(engine.getState().enabled, false);
  assert.equal(engine.getState().playing, false);
  assert.equal(engine._gate.gain.value, 0);
  assert.equal(ctx.state, 'suspended');
});
await engine.setEnabled(true);
const originalDrop = engine._drop;
engine._drop = () => { throw new Error('Synthetic scheduling failure'); };
engine._nextDrop = ctx.currentTime;
engine._safeSchedule();
check('synthesis errors mute and stop the scheduler instead of failing repeatedly', () => {
  assert.equal(engine.getState().errorCode, 'synthesis-error');
  assert.equal(engine.getState().playing, false);
  assert.equal(engine._gate.gain.value, 0);
  assert.equal(engine._scheduler, null);
});
engine._drop = originalDrop;
await engine.setEnabled(true);
check('an explicit gesture can recover a transient synthesis error', () => assert.equal(engine.getState().playing, true));
await engine.destroy();
await engine.setEnabled(true);
engine.update({ scene: 'bed' });
check('destroy closes audio, removes listeners, and is final', () => {
  assert.equal(ctx.state, 'closed');
  assert.equal(engine.getState().status, 'destroyed');
  assert.equal(engine._scheduler, null);
  assert.equal(engine._sources.size, 0);
  assert.equal(documentEvents.listeners.get('visibilitychange').size, 0);
  assert.equal(pageEvents.listeners.get('pagehide').size, 0);
  assert.equal(FakeContext.instances.length, 1);
});
const originalPanner = FakeContext.prototype.createStereoPanner;
const originalHold = Param.prototype.cancelAndHoldAtTime;
FakeContext.prototype.createStereoPanner = undefined;
Param.prototype.cancelAndHoldAtTime = undefined;
delete navigatorStub.userActivation;
const olderBrowser = new RainyAudio();
await olderBrowser.setEnabled(true);
olderBrowser.update({ scene: 'table', rain: 0.3, master: 0.6 });
check('older-browser fallbacks work without stereo panner, hold automation, or activation API', () => {
  assert.equal(olderBrowser.getState().playing, true);
  assert.equal(olderBrowser.getState().settings.scene, 'table');
});
await olderBrowser.destroy();
FakeContext.prototype.createStereoPanner = originalPanner;
Param.prototype.cancelAndHoldAtTime = originalHold;
navigatorStub.userActivation = { isActive: true };
globalThis.AudioContext = undefined;
const unsupported = new RainyAudio();
await unsupported.setEnabled(true);
check('unsupported browsers fail honestly without throwing', () => assert.equal(unsupported.getState().status, 'unsupported'));
await unsupported.destroy();
check('state callbacks include startup, playback, and lifecycle transitions', () => {
  assert.ok(observed.some(s => s.status === 'starting'));
  assert.ok(observed.some(s => s.status === 'playing'));
  assert.ok(observed.some(s => s.status === 'paused'));
  assert.ok(observed.some(s => s.status === 'interrupted'));
});
console.log(`\n${checks} audio checks passed. Browser speaker quality and physical iPhone testing remain manual.`);
