/**
 * Independent application-state regression checks, using a minimal modeled DOM.
 * Run: node tests/app-test.mjs
 * These verify the real app.js state/event logic. They do NOT verify browser
 * layout, accessibility-tree computation, audible output, or a physical iPhone.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFileSync(path.join(base, name), 'utf8');
const html = read('index.html');
const masks = JSON.parse(read('assets/scene-masks.js').match(/export const roomMasks = (.*);/)[1]);
const sceneSource = read('scenes.js').replace(/^import .*;$/m, '').replaceAll('export ', '');
const appSource = read('app.js').replace(/^import .*;$/mg, '');
const records = [];
const tick = () => new Promise(resolve => setImmediate(resolve));

class ClassList {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach(value => this.values.add(value)); }
  remove(...values) { values.forEach(value => this.values.delete(value)); }
  contains(value) { return this.values.has(value); }
  toggle(value, force) {
    if (force ?? !this.values.has(value)) this.values.add(value);
    else this.values.delete(value);
  }
  toString() { return [...this.values].join(' '); }
}

function createApp() {
  let now = 1000;
  let heldPath = null;
  let heldImage = null;
  let failPath = null;
  let document;
  const noop = () => {};
  class Element {
    constructor(id = '') {
      Object.assign(this, {
        id, classList: new ClassList(), dataset: {}, style: {}, children: [],
        listeners: {}, attributes: {}, inert: false, hidden: false, disabled: false,
        clientWidth: 390, clientHeight: 844, complete: true, naturalWidth: 1448,
        naturalHeight: 1086, open: false, tagName: 'BUTTON',
      });
    }
    setAttribute(key, value) { this.attributes[key] = value; }
    getAttribute(key) { return this.attributes[key] ?? null; }
    removeAttribute(key) { delete this.attributes[key]; }
    addEventListener(key, fn) { (this.listeners[key] ??= []).push(fn); }
    replaceChildren(...values) { this.children = values; }
    append(value) { this.children.push(value); }
    get className() { return this.classList.toString(); }
    set className(value) { this.classList.values = new Set(value.split(' ')); }
    querySelector(selector) { return this.special?.[selector]; }
    getContext() {
      return new Proxy({
        createLinearGradient() { return { addColorStop: noop }; },
        createRadialGradient() { return { addColorStop: noop }; },
      }, { get: (target, key) => key in target ? target[key] : noop });
    }
    focus() { document.activeElement = this; }
    setPointerCapture() {}
    hasPointerCapture() { return false; }
    get offsetWidth() { return 390; }
    getBoundingClientRect() { return { left: 0, right: 390, top: 0, bottom: 844 }; }
    showModal() { this.open = true; }
    close() { this.open = false; }
  }
  const ids = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], new Element(match[1])]));
  const layers = ['scene-a', 'scene-b'].map(id => {
    const element = ids[id];
    element.className = 'scene-layer';
    element.special = {
      '.scene-image': new Element(), '.atmosphere': new Element(), '.object-layer': new Element(),
    };
    return element;
  });
  const nav = ['bed', 'window', 'sofa', 'table'].map(key => {
    const element = new Element();
    element.dataset.go = key;
    return element;
  });
  const chrome = Array.from({ length: 6 }, () => new Element());
  const wordmark = new Element();
  document = {
    hidden: false, listeners: {},
    querySelector(selector) { return selector === '.wordmark' ? wordmark : ids[selector.slice(1)]; },
    querySelectorAll(selector) {
      return selector === '.scene-layer' ? layers : selector === '[data-go]' ? nav : selector === '.chrome' ? chrome : [];
    },
    createElement() { return new Element(); },
    addEventListener(key, fn) { (this.listeners[key] ??= []).push(fn); },
  };
  class Image {
    constructor() { this.naturalWidth = 1448; this.naturalHeight = 1086; }
    set src(value) {
      this._src = value;
      if (value === heldPath) { heldImage = this; return; }
      queueMicrotask(() => value === failPath ? this.onerror?.() : this.onload?.());
    }
    get src() { return this._src; }
  }
  class RainyAudio {
    constructor({ onState }) { this.onState = onState; }
    update(settings) { this.settings = settings; }
    async setEnabled(enabled) {
      this.onState({ enabled, playing: enabled, status: enabled ? 'playing' : 'off' });
    }
    handleVisibility(hidden) { this.hidden = hidden; }
  }
  const location = { hash: '#bed' };
  const window = { listeners: {}, addEventListener(key, fn) { (this.listeners[key] ??= []).push(fn); } };
  const context = {
    document, window, matchMedia: () => ({ matches: false }), devicePixelRatio: 1,
    RainyAudio, Image, roomMasks: masks, performance: { now: () => now },
    setTimeout: () => 1, clearTimeout: noop, requestAnimationFrame: noop,
    requestIdleCallback: noop, location,
    history: {
      pushState(_state, _title, hash) { location.hash = hash; },
      replaceState(_state, _title, hash) { location.hash = hash; },
    },
    console,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(`${sceneSource}\n${appSource}\nglobalThis.testApp = {
    go, primaryAction, setRest, syncSceneUI, layoutLayer, state, layers, assets,
    frame, objectAction, toggleSound, audio, positions,
    get current() { return currentLayer; },
    get navigationToken() { return navigationToken; }
  };`, context);
  return {
    app: context.testApp, ids, nav, document, window, location,
    setNow(value) { now = value; },
    hold(path) { heldPath = path; heldImage = null; context.testApp.assets.delete(path); },
    release() { const image = heldImage; heldPath = null; image.onload(); },
    fail(path) { failPath = path; context.testApp.assets.delete(path); },
    clearFailure() { failPath = null; },
  };
}

function check(name, condition, evidence) {
  records.push({ name, passed: Boolean(condition), evidence });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}`);
  if (!condition && evidence !== undefined) console.log(JSON.stringify(evidence));
}

const { app, ids, nav, document, window, location, ...control } = createApp();
await tick();
check('initial bed scene loads', app.state.scene === 'bed' && app.current.scene === 'bed');
await app.go('window');
await app.go('bed');
await app.primaryAction();
check('blanket reuse clears departing opacity class', !app.current.el.classList.contains('departing'));
check('blanket uses the covered asset', app.current.img.src === './assets/bed-covered.webp');
await app.primaryAction();
check('blanket toggles back to uncovered asset', app.current.img.src === './assets/bed.webp' && ids.primary.getAttribute('aria-pressed') === 'false');
app.setRest(true);
check('rest moves keyboard focus to wake', document.activeElement.id === 'wake');
check('rest makes every hotspot layer inert', app.layers.every(layer => layer.objects.inert));
app.setRest(false);
check('rest exit restores focus to rest button', document.activeElement.id === 'rest');
await app.go('sofa');
check('navigation after rest exit restores hotspot interaction', !app.current.objects.inert);

await app.go('bed');
control.hold('./assets/window.webp');
const pendingWindow = app.go('window');
await tick();
await app.go('bed');
check('current-scene click cancels pending navigation busy state', !ids.stay.getAttribute('aria-busy'));
control.release();
await pendingWindow;
check('latest current-scene request beats older pending image', app.state.scene === 'bed' && location.hash === '#bed');

control.hold('./assets/window.webp');
const staleWindow = app.go('window');
await tick();
await app.go('table');
control.release();
await staleWindow;
check('latest different-scene request beats older pending image', app.state.scene === 'table' && location.hash === '#table');

await app.primaryAction();
check('warming tea updates pressed state', ids.primary.getAttribute('aria-pressed') === 'true');
control.setNow(92000);
app.frame(92000);
check('tea pressed state expires with steam', app.state.warmUntil === 0 && ids.primary.getAttribute('aria-pressed') === 'false');
for (const scene of ['bed', 'window', 'sofa', 'table']) {
  await app.go(scene);
  check(`${scene} navigation synchronizes scene and current nav`,
    ids.stay.dataset.scene === scene && nav.filter(item => item.getAttribute('aria-current')).length === 1 && nav.find(item => item.dataset.go === scene).getAttribute('aria-current') === 'location');
}
await app.go('sofa');
const tvBefore = app.state.tvOn;
await app.primaryAction();
check('TV primary synchronizes panel and audio', app.state.tvOn !== tvBefore && ids['tv-toggle'].getAttribute('aria-pressed') === String(!tvBefore) && app.audio.settings.tvOn === !tvBefore);
ids['tv-toggle'].listeners.click[0]();
check('TV panel synchronizes primary and audio', app.state.tvOn === tvBefore && ids.primary.getAttribute('aria-pressed') === String(tvBefore) && app.audio.settings.tvOn === tvBefore);
for (const [kind, value] of [['rain', 0], ['tv', 100], ['master', 42]]) {
  ids[`${kind}-volume`].listeners.input[0]({ target: { value: String(value) } });
  check(`${kind} slider synchronizes output and audio`, ids[`${kind}-value`].textContent === `${value}%` && app.audio.settings[kind] === value / 100);
}
await app.toggleSound();
check('sound UI turns on', ids.sound.getAttribute('aria-pressed') === 'true');
await app.toggleSound();
check('sound UI turns off', ids.sound.getAttribute('aria-pressed') === 'false');

app.setRest(true);
await app.go('bed');
app.setRest(false);
check('rest exit after navigation restores visible hotspot tab order', app.current.objects.children.filter(button => !button.hidden).every(button => button.tabIndex === 0));
const keyboard = document.listeners.keydown[0];
keyboard({ key: 'ArrowRight', target: { tagName: 'BUTTON' }, preventDefault() {} });
await tick();
check('ArrowRight navigates to next scene', app.state.scene === 'window');
app.setRest(true);
keyboard({ key: 'Escape', target: { tagName: 'BUTTON' }, preventDefault() {} });
check('Escape exits rest and restores focus', !app.state.resting && document.activeElement.id === 'rest');
ids['sound-settings'].open = true;
keyboard({ key: 'ArrowRight', target: { tagName: 'BUTTON' }, preventDefault() {} });
await tick();
check('open settings suppresses background arrow navigation', app.state.scene === 'window');
ids['sound-settings'].open = false;

location.hash = '#bed';
window.listeners.popstate[0]();
await tick();
check('popstate restores preceding scene', app.state.scene === 'bed' && location.hash === '#bed');
location.hash = '#window';
window.listeners.popstate[0]();
await tick();
check('popstate restores following scene', app.state.scene === 'window' && location.hash === '#window');

const panBefore = app.positions.window;
ids.world.listeners.pointerdown[0]({ button: 0, target: { closest() { return null; } }, pointerId: 1, clientX: 190 });
ids.world.listeners.pointermove[0]({ pointerId: 1, clientX: 310 });
ids.world.listeners.pointerup[0]({ pointerId: 1 });
check('horizontal pointer movement updates bounded scene pan', app.positions.window !== panBefore && app.positions.window >= 0 && app.positions.window <= 1);
await app.primaryAction();
check('window listening updates pressed state and audio distance', ids.primary.getAttribute('aria-pressed') === 'true' && app.audio.settings.tv === app.state.tv * 0.35);
for (const [name, width, height] of [['mobile', 390, 844], ['small', 320, 568], ['landscape', 844, 390], ['desktop', 1440, 900]]) {
  ids.world.clientWidth = width;
  ids.world.clientHeight = height;
  for (const scene of ['bed', 'window', 'sofa', 'table']) {
    await app.go(scene);
    app.layoutLayer(app.current);
    const geometry = app.current.geometry;
    check(`${name} ${scene} geometry covers viewport`, geometry.x <= 0 && geometry.y <= 0 && geometry.x + geometry.width >= width - 0.00001 && geometry.y + geometry.height >= height - 0.00001);
  }
}
check('mobile rest icon has an explicit accessible name in source', /id="rest"[^>]*aria-label="[^"]+"/.test(html));

await app.go('bed');
control.fail('./assets/window.webp');
await app.go('window');
check('failed image navigation preserves current room and clears busy', app.state.scene === 'bed' && !ids.stay.getAttribute('aria-busy'));
control.clearFailure();
await app.go('window');
check('failed image can be retried successfully', app.state.scene === 'window');

const startup = createApp();
await startup.app.go('bed');
await tick();
check('current-scene request during first image load still initializes room', startup.app.current.scene === 'bed');

const failures = records.filter(record => !record.passed);
assert.equal(failures.length, 0, `${failures.length} app-state checks failed: ${failures.map(failure => failure.name).join(', ')}`);
console.log(`\n${records.length} app-state checks passed. Modeled DOM only; browser rendering, actual history behavior, and physical iPhone testing remain separate.`);
