import { RainyAudio } from './audio.js';
import { scenes, order, coverGeometry, toScreen } from './scenes.js';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const stay = $('#stay'), world = $('#world'), dialog = $('#sound-settings');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const state = { scene: 'bed', covered: false, listening: false, warmUntil: 0, dim: false, tvOn: true, resting: false, rain: .75, tv: .35, master: .65 };
const layers = $$('.scene-layer').map(el => ({ el, img: $('.scene-image', el), canvas: $('.atmosphere', el), objects: $('.object-layer', el), ctx: $('.atmosphere', el).getContext('2d'), scene: null, geometry: null, curtainUntil: 0 }));
const positions = Object.fromEntries(order.map(key => [key, scenes[key].focal]));
const assets = new Map();
let currentLayer = layers[0], navigationToken = 0, captionTimer, drag = null, ignoreClickUntil = 0, lastFrame = 0, blanketBusy = false;
let audioState = { enabled: false, playing: false, status: 'off' };
const audio = new RainyAudio({ onState: next => { audioState = next; syncAudioUI(); } });
function say(message) { const el = $('#caption'); el.textContent = message; el.classList.add('show'); clearTimeout(captionTimer); captionTimer = setTimeout(() => el.classList.remove('show'), 3100); }
function asset(path) {
  if (assets.has(path)) return assets.get(path);
  const promise = new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => { assets.delete(path); reject(new Error('image-load')); }; image.src = path; });
  assets.set(path, promise); return promise;
}
function sceneImage(key) { return key === 'bed' && state.covered ? './assets/bed-covered.webp' : scenes[key].image; }
function configureLayer(layer, key, image) {
  clearTimeout(layer.fadeTimer); layer.el.classList.remove('departing'); layer.objects.inert = state.resting;
  layer.scene = key; layer.naturalWidth = image.naturalWidth; layer.naturalHeight = image.naturalHeight; layer.img.src = image.src; layer.img.alt = scenes[key].alt; layer.img.onload = () => layoutLayer(layer);
  layer.objects.replaceChildren();
  const hotspots = scenes[key].hotspots || [];
  for (const item of hotspots) {
    const button = document.createElement('button'); button.className = 'hotspot'; button.dataset.action = item.action; button.dataset.label = item.label; button.setAttribute('aria-label', item.label); button.setAttribute('title', item.label);
    button.addEventListener('click', e => { e.stopPropagation(); if (performance.now() < ignoreClickUntil) return; objectAction(item.action, layer); });
    layer.objects.append(button);
  }
  layoutLayer(layer);
}
function layoutLayer(layer) {
  if (!layer.scene || !layer.naturalWidth) return;
  const width = world.clientWidth, height = world.clientHeight;
  const zoom = layer.scene === 'window' && state.listening ? 1.075 : 1;
  const geometry = coverGeometry(width, height, layer.naturalWidth, layer.naturalHeight, positions[layer.scene], zoom);
  layer.geometry = geometry;
  Object.assign(layer.img.style, { width: `${geometry.width}px`, height: `${geometry.height}px`, left: `${geometry.x}px`, top: `${geometry.y}px` });
  const dpr = Math.min(devicePixelRatio || 1, 1.6);
  if (layer.canvas.width !== Math.round(width * dpr) || layer.canvas.height !== Math.round(height * dpr)) { layer.canvas.width = Math.round(width * dpr); layer.canvas.height = Math.round(height * dpr); }
  layer.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const hotspots = scenes[layer.scene].hotspots || [];
  [...layer.objects.children].forEach((button, index) => { const [x, y] = toScreen(hotspots[index].point, geometry); button.style.left = `${x}px`; button.style.top = `${y}px`; const visible = x > 23 && x < width - 23 && y > 85 && y < height - 115; button.hidden = !visible; button.tabIndex = visible && layer === currentLayer && !state.resting ? 0 : -1; });
}
async function go(key, { initial = false, replace = false } = {}) {
  if (!scenes[key]) return;
  if (!initial && currentLayer.scene && key === state.scene) { ++navigationToken; stay.removeAttribute('aria-busy'); return; }
  const token = ++navigationToken;
  stay.setAttribute('aria-busy', 'true');
  try {
    const image = await asset(sceneImage(key)); if (token !== navigationToken) return;
    const incoming = initial ? currentLayer : layers.find(layer => layer !== currentLayer), outgoing = currentLayer;
    incoming.el.classList.remove('current', 'departing'); incoming.el.setAttribute('aria-hidden', 'false'); incoming.el.inert = false;
    state.scene = key; stay.dataset.scene = key; currentLayer = incoming; configureLayer(incoming, key, image);
    void incoming.el.offsetWidth; incoming.el.classList.add('current');
    if (!initial) { outgoing.el.classList.remove('current'); outgoing.el.classList.add('departing'); outgoing.el.setAttribute('aria-hidden', 'true'); outgoing.el.inert = true; outgoing.fadeTimer = setTimeout(() => outgoing.el.classList.remove('departing'), reducedMotion.matches ? 0 : 1200); }
    syncSceneUI(); updateAudio(); syncAudioUI();
    if (location.hash !== `#${key}`) history[replace || initial ? 'replaceState' : 'pushState']({ scene: key }, '', `#${key}`);
    $('#load-error').hidden = true; $('#loading').classList.add('fading'); setTimeout(() => { $('#loading').hidden = true; }, reducedMotion.matches ? 0 : 700);
    if (!initial) { $('#arrival').hidden = true; }
  } catch { if (token === navigationToken) { if (!currentLayer.scene) { $('#loading').hidden = true; $('#load-error').hidden = false; } else say('이 자리를 불러오지 못했어요. 한 번 더 눌러주세요.'); } }
  finally { if (token === navigationToken) stay.removeAttribute('aria-busy'); }
}
function syncSceneUI() {
  const data = scenes[state.scene]; $('#scene-title').textContent = data.title; $('#scene-eyebrow').textContent = data.eyebrow; $('#scene-description').textContent = data.description;
  $$('[data-go]').forEach(button => { if (button.dataset.go === state.scene) button.setAttribute('aria-current', 'location'); else button.removeAttribute('aria-current'); });
  $('#primary-label').textContent = state.scene === 'bed' ? state.covered ? '이불 살짝 내리기' : '이불 덮기' : state.scene === 'window' ? state.listening ? '편하게 기대기' : '비에 귀 기울이기' : state.scene === 'sofa' ? state.tvOn ? 'TV 끄기' : 'TV 켜기' : state.warmUntil > performance.now() ? '차의 온기 느끼기' : '차 데우기';
  $('#primary').setAttribute('aria-pressed', String(state.scene === 'bed' ? state.covered : state.scene === 'window' ? state.listening : state.scene === 'sofa' ? state.tvOn : state.warmUntil > performance.now()));
  $('#light').setAttribute('aria-pressed', String(state.dim)); $('#light').setAttribute('aria-label', state.dim ? '조명 밝히기' : '조명 낮추기');
  $('#tv-toggle').setAttribute('aria-pressed', String(state.tvOn)); $('#tv-toggle').setAttribute('aria-label', state.tvOn ? 'TV 끄기' : 'TV 켜기'); stay.classList.toggle('dim', state.dim);
}
function updateAudio() { audio.update({ scene: state.scene, rain: state.rain * (state.scene === 'window' && state.listening ? 1.2 : 1), tv: state.tv * (state.scene === 'window' && state.listening ? .35 : 1), master: state.master, curtainsClosed: false, windowOpen: false, tvOn: state.tvOn }); }
function syncAudioUI() {
  const playing = audioState.playing, needsGesture = audioState.needsGesture;
  const unsupported = audioState.status === 'unsupported';
  const label = unsupported ? '소리 미지원' : audioState.status === 'starting' ? '소리 준비 중' : playing ? '소리 끄기' : needsGesture ? '소리 다시 켜기' : '소리 켜기';
  $('#sound-label').textContent = label; $('#panel-sound').textContent = label; $('#sound').setAttribute('aria-pressed', String(playing)); $('#sound').classList.toggle('playing', playing);
  $('#audio-detail').textContent = unsupported ? '이 브라우저에서는 소리를 지원하지 않아요.' : audioState.error ? '소리를 시작하지 못했어요. 한 번 더 눌러주세요.' : needsGesture ? '잠시 멈췄어요. 눌러서 다시 들을 수 있어요.' : playing ? `${scenes[state.scene].name} · ${state.scene === 'window' ? '창에 가까운 빗소리' : state.scene === 'sofa' ? '소파 앞 TV와 창밖의 비' : state.scene === 'bed' ? '조금 멀리서 들리는 숲의 비' : '차 한 잔 곁의 빗소리'}` : '소리를 켜면 빗소리가 시작돼요.';
}
async function toggleSound() { updateAudio(); await audio.setEnabled(!(audioState.playing || audioState.status === 'starting')); syncAudioUI(); }
async function primaryAction() {
  if (state.scene === 'bed') {
    if (blanketBusy) return; blanketBusy = true;
    const next = !state.covered, token = navigationToken; $('#primary').disabled = true;
    try { const image = await asset(next ? './assets/bed-covered.webp' : scenes.bed.image); state.covered = next; if (state.scene === 'bed' && token === navigationToken) { const incoming = layers.find(layer => layer !== currentLayer), outgoing = currentLayer; currentLayer = incoming; configureLayer(incoming, 'bed', image); incoming.el.inert = false; incoming.el.setAttribute('aria-hidden', 'false'); incoming.el.classList.add('current'); outgoing.el.classList.remove('current'); outgoing.el.inert = true; outgoing.el.setAttribute('aria-hidden', 'true'); } say(next ? '포근한 이불을 끌어올렸어요.' : '이불을 조금 내려놓았어요.'); }
    catch { say('이불을 불러오지 못했어요. 다시 눌러주세요.'); }
    finally { blanketBusy = false; $('#primary').disabled = false; }
  } else if (state.scene === 'window') { state.listening = !state.listening; layoutLayer(currentLayer); say(state.listening ? '잠시, 비가 들려주는 소리에 집중해요.' : '다시 편안히 기대어 쉬어요.'); }
  else if (state.scene === 'sofa') { state.tvOn = !state.tvOn; say(state.tvOn ? '작은 화면에 느린 밤이 흘러요.' : 'TV를 끄고 비만 바라봐요.'); }
  else { state.warmUntil = performance.now() + 90000; say('머그에서 따뜻한 김이 피어나요.'); }
  syncSceneUI(); updateAudio();
}
function objectAction(action, layer) {
  if (action.startsWith('go:')) { go(action.slice(3)); return; }
  if (action === 'light') { toggleLight(); return; }
  if (action === 'curtain') { layer.curtainUntil = performance.now() + 5500; say('린넨 커튼이 부드럽게 흔들려요.'); return; }
  if (action === 'tv') { state.tvOn = !state.tvOn; syncSceneUI(); updateAudio(); return; }
  if (action === 'tea') { state.warmUntil = performance.now() + 90000; syncSceneUI(); say('차의 온기가 천천히 올라와요.'); return; }
  if (action === 'blanket') { if (state.scene === 'bed') primaryAction(); else go('bed'); }
}
function toggleLight() { state.dim = !state.dim; syncSceneUI(); }
function setRest(resting) {
  state.resting = resting; stay.classList.toggle('resting', resting); $('#rest').setAttribute('aria-pressed', String(resting)); $('#wake').hidden = !resting;
  $$('.chrome').forEach(el => { el.inert = resting; }); layers.forEach(layer => { layer.objects.inert = resting || layer !== currentLayer; layoutLayer(layer); });
  if (resting) $('#wake').focus({ preventScroll: true }); else $('#rest').focus({ preventScroll: true });
}
$$('[data-go]').forEach(button => button.addEventListener('click', () => go(button.dataset.go)));
$('.wordmark').addEventListener('click', e => { e.preventDefault(); go('bed'); });
$('#primary').addEventListener('click', primaryAction); $('#light').addEventListener('click', toggleLight);
$('#sound').addEventListener('click', toggleSound); $('#panel-sound').addEventListener('click', toggleSound);
$('#settings').addEventListener('click', () => { syncAudioUI(); dialog.showModal(); });
$('#tv-toggle').addEventListener('click', () => { state.tvOn = !state.tvOn; syncSceneUI(); updateAudio(); });
for (const kind of ['rain', 'tv', 'master']) $(`#${kind}-volume`).addEventListener('input', e => { state[kind] = Number(e.target.value) / 100; $(`#${kind}-value`).textContent = `${e.target.value}%`; updateAudio(); });
$('#rest').addEventListener('click', () => setRest(true)); $('#wake').addEventListener('click', () => setRest(false)); $('#arrival-close').addEventListener('click', () => { $('#arrival').hidden = true; }); $('#retry').addEventListener('click', () => { $('#load-error').hidden = true; $('#loading').hidden = false; go(state.scene, { initial: true }); });
dialog.addEventListener('click', e => { if (e.target === dialog) { const rect = dialog.getBoundingClientRect(); if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) dialog.close(); } });
world.addEventListener('pointerdown', e => { if (e.button !== 0 || e.target.closest('button')) return; drag = { id: e.pointerId, x: e.clientX, start: positions[state.scene], moved: false, scene: state.scene }; world.setPointerCapture(e.pointerId); });
world.addEventListener('pointermove', e => { if (!drag || drag.id !== e.pointerId || drag.scene !== state.scene) return; const delta = e.clientX - drag.x; if (Math.abs(delta) > 7) drag.moved = true; if (drag.moved) { const available = Math.max(1, currentLayer.geometry.width - world.clientWidth); positions[state.scene] = Math.max(0, Math.min(1, drag.start - delta / available)); layoutLayer(currentLayer); } });
function endDrag(e) { if (!drag || e.pointerId !== drag.id) return; if (drag.moved) { ignoreClickUntil = performance.now() + 250; $('#arrival').hidden = true; } drag = null; if (world.hasPointerCapture(e.pointerId)) world.releasePointerCapture(e.pointerId); }
world.addEventListener('pointerup', endDrag); world.addEventListener('pointercancel', endDrag);
window.addEventListener('resize', () => layers.forEach(layoutLayer));
window.addEventListener('popstate', () => go(scenes[location.hash.slice(1)] ? location.hash.slice(1) : 'bed', { replace: true }));
document.addEventListener('keydown', e => { if (dialog.open || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return; if (e.key === 'Escape' && state.resting) { setRest(false); return; } if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const next = (order.indexOf(state.scene) + (e.key === 'ArrowRight' ? 1 : -1) + order.length) % order.length; go(order[next]); } });
document.addEventListener('visibilitychange', () => audio.handleVisibility(document.hidden));
window.addEventListener('pagehide', () => audio.handleVisibility(true));
window.addEventListener('pageshow', () => { if (!document.hidden) audio.handleVisibility(false); });
function polygon(ctx, points, g) { ctx.beginPath(); points.forEach((point, i) => { const [x, y] = toScreen(point, g); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); }
function drawRain(ctx, data, g, time) {
  if (!data.windows?.length) return;
  ctx.save(); ctx.beginPath(); for (const shape of data.windows) { shape.forEach((point, i) => { const [x, y] = toScreen(point, g); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); } ctx.clip();
  const t = reducedMotion.matches ? 12 : time / 1000;
  for (let i = 0; i < 68; i++) { const nx = ((i * .6180339887) % 1), ny = ((i * .381966 + t * (.013 + (i % 5) * .004)) % 1); const x = g.x + nx * g.width, y = g.y + ny * g.height; const len = (4 + (i % 5) * 3) * g.scale; ctx.strokeStyle = `rgba(221,236,239,${.055 + (i % 4) * .024})`; ctx.lineWidth = (.65 + i % 3 * .26) * g.scale; ctx.beginPath(); ctx.moveTo(x, y); ctx.bezierCurveTo(x + 1, y + len * .2, x - 1, y + len * .8, x, y + len); ctx.stroke(); }
  ctx.restore();
}
function drawTV(ctx, data, g, time) {
  if (!data.tv?.length || !state.tvOn) return;
  const coords = data.tv.map(point => toScreen(point, g)); const xs = coords.map(p => p[0]), ys = coords.map(p => p[1]); const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(...xs) - x, h = Math.max(...ys) - y;
  ctx.save(); polygon(ctx, data.tv, g); ctx.clip();
  const t = reducedMotion.matches ? 6 : time / 1000; const sky = ctx.createLinearGradient(x, y, x, y + h); sky.addColorStop(0, '#20353f'); sky.addColorStop(.68, '#849a97'); sky.addColorStop(1, '#354f53'); ctx.fillStyle = sky; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#eedbbb'; ctx.globalAlpha = .75; ctx.beginPath(); ctx.arc(x + w * .68, y + h * .30, w * .041, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
  for (let row = 0; row < 3; row++) { ctx.fillStyle = ['#52696b', '#334e53', '#183940'][row]; ctx.beginPath(); ctx.moveTo(x, y + h); for (let i = 0; i <= 35; i++) { const px = i / 35; const mountain = .51 + row * .12 + Math.sin(px * 10 + row * 2 + t * .009) * .055 + Math.cos(px * 21 + row) * .033; ctx.lineTo(x + px * w, y + h * mountain); } ctx.lineTo(x + w, y + h); ctx.fill(); }
  ctx.globalAlpha = .18; ctx.fillStyle = '#c4ddcf'; for (let i = 0; i < 6; i++) { const float = (t * .008 + i * .17) % 1; ctx.fillRect(x + float * w, y + h * (.78 + i * .022), w * (.15 + .04 * Math.sin(i + t * .15)), .45 * g.scale); }
  ctx.globalAlpha = .14; ctx.fillStyle = '#dfcfb8'; ctx.fillRect(x, y, w, h); ctx.restore();
}
function drawSteam(ctx, data, g, time) {
  if (!data.mug || state.warmUntil < time) return;
  const [x, y] = toScreen(data.mug, g), life = Math.min(1, (state.warmUntil - time) / 30000), t = reducedMotion.matches ? 4 : time / 1000; const size = (data.steamSize || .025) * g.width;
  ctx.save(); ctx.lineCap = 'round'; ctx.filter = `blur(${Math.max(.7, size * .05)}px)`;
  for (let i = 0; i < 4; i++) { const phase = (t * .23 + i * .24) % 1, yy = y - phase * size * 3.2, sway = Math.sin(t * .72 + i * 2) * size * .3, alpha = Math.sin(phase * Math.PI) * .19 * life; ctx.strokeStyle = `rgba(242,239,223,${alpha})`; ctx.lineWidth = size * (.07 + phase * .09); ctx.beginPath(); ctx.moveTo(x + sway - size * .14, yy); ctx.bezierCurveTo(x - size * .3 + sway, yy - size * .3, x + size * .38 + sway, yy - size * .6, x + sway, yy - size * .9); ctx.stroke(); }
  ctx.restore();
}
function drawCurtains(ctx, layer, data, g, time) {
  if (!layer.img.complete || reducedMotion.matches || !data.curtains?.length || layer.curtainUntil < time) return;
  const remaining = (layer.curtainUntil - time) / 5500, shift = Math.sin(time / 750) * 3 * Math.sin(remaining * Math.PI);
  ctx.save(); for (const shape of data.curtains) { ctx.save(); polygon(ctx, shape, g); ctx.clip(); ctx.drawImage(layer.img, g.x + shift, g.y, g.width, g.height); ctx.restore(); } ctx.restore();
}
function drawLamp(ctx, data, g, time) {
  if (!data.lamps?.length) return;
  for (const point of data.lamps) { const [x, y] = toScreen(point, g); const radius = g.width * .065; const alpha = state.dim ? .005 : reducedMotion.matches ? .033 : .027 + Math.sin(time / 3800) * .006; const glow = ctx.createRadialGradient(x, y, 0, x, y, radius); glow.addColorStop(0, `rgba(255,190,89,${alpha})`); glow.addColorStop(1, 'rgba(255,190,89,0)'); ctx.fillStyle = glow; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2); }
}
function frame(time) { requestAnimationFrame(frame); if (document.hidden || time - lastFrame < (reducedMotion.matches ? 250 : 33)) return; lastFrame = time; if (state.warmUntil && state.warmUntil <= time) { state.warmUntil = 0; syncSceneUI(); } for (const layer of layers) { if (!layer.scene || !layer.geometry) continue; if (layer !== currentLayer && !layer.el.classList.contains('departing')) continue; const ctx = layer.ctx, data = scenes[layer.scene], g = layer.geometry; ctx.clearRect(0, 0, world.clientWidth, world.clientHeight); drawRain(ctx, data, g, time); drawTV(ctx, data, g, time); drawSteam(ctx, data, g, time); drawCurtains(ctx, layer, data, g, time); drawLamp(ctx, data, g, time); } }
requestAnimationFrame(frame);
const initial = scenes[location.hash.slice(1)] ? location.hash.slice(1) : 'bed'; go(initial, { initial: true });
// Load upcoming camera views without delaying the first room or audio gesture.
const preload = () => order.filter(key => key !== initial).forEach(key => asset(scenes[key].image).catch(() => {}));
if ('requestIdleCallback' in window) requestIdleCallback(preload, { timeout: 2500 }); else setTimeout(preload, 1200);
syncSceneUI();
