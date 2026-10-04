import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { scenes, order, coverGeometry, toScreen } from '../scenes.js';
let passed = 0;
function test(name, fn) { fn(); console.log(`PASS ${name}`); passed++; }
const manifest = JSON.parse(await readFile(new URL('../assets/provenance.json', import.meta.url)));
for (const key of order) {
  const scene = scenes[key];
  const source = await readFile(new URL(`../${scene.image}`, import.meta.url));
  test(`${key}: WebP source exists`, () => { assert.equal(source.subarray(0, 4).toString(), 'RIFF'); assert.equal(source.subarray(8, 12).toString(), 'WEBP'); assert(source.length < 400000); });
  test(`${key}: rain only uses valid glass polygons`, () => { assert.equal(scene.windows.length, 3); for (const points of scene.windows) { assert(points.length >= 4); for (const [x, y] of points) assert(x >= 0 && x <= 1 && y >= 0 && y <= 1); } });
  test(`${key}: physical hotspot positions and actions`, () => { for (const spot of scene.hotspots) { assert(spot.label); assert(/^(go:(bed|window|sofa|table)|tea|tv|light|blanket|curtain)$/.test(spot.action)); assert(spot.point.every(p => p >= 0 && p <= 1)); } });
}
test('four distinct images, rather than four crops', () => assert.equal(new Set(order.map(k => scenes[k].image)).size, 4));
test('window view correctly has no TV overlay', () => assert.equal(scenes.window.tv, null));
test('five full assets are under 1.5 MB', () => assert(manifest.files.reduce((n, f) => n + f.webpBytes, 0) < 1500000));
for (const [width, height] of [[390,844],[320,568],[844,390],[1440,900],[1920,1080]]) {
  for (const pan of [0,.25,.5,.75,1]) {
    const g = coverGeometry(width,height,1448,1086,pan);
    test(`${width}×${height} pan ${pan}: image covers view and masks stay attached`, () => { assert(g.width >= width - .001); assert(g.height >= height - .001); assert(g.x <= 0 && g.x + g.width >= width - .001); assert(g.y <= 0 && g.y + g.height >= height - .001); const point = toScreen([.5,.5],g); assert.equal(point[0],g.x + g.width / 2); assert.equal(point[1],g.y + g.height / 2); });
  }
}
const html = await readFile(new URL('../index.html', import.meta.url),'utf8');
const app = await readFile(new URL('../app.js', import.meta.url),'utf8');
const css = await readFile(new URL('../style.css', import.meta.url),'utf8');
test('no third-party visual/audio dependency', () => { assert(!/https?:\/\//.test([html,app,css].join('\n'))); });
test('viewport permits pinch-zoom', () => assert(!/user-scalable=no|maximum-scale=1/.test(html)));
test('all controls have keyboard-visible focus', () => assert(css.includes(':focus-visible')));
test('motion preference respected in CSS and canvas', () => { assert(css.includes('prefers-reduced-motion')); assert(app.includes('reducedMotion.matches')); });
test('no fake media progress or fake weather', () => { assert(!html.includes('class="bar"')); assert(!html.includes('18°C')); });
await stat(new URL('../assets/bed-covered.webp', import.meta.url));
console.log(`\n${passed} scene/asset checks passed. These are geometry/source checks, not browser rendering tests.`);
