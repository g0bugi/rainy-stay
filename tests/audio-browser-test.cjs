// Native Chromium/Web Audio smoke test. Requires Playwright and Chromium.
// Run: node tests/audio-browser-test.cjs
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const code = fs.readFileSync(path.join(__dirname, '..', 'audio.js'));
const html = `<!doctype html><button id="start">Start sound</button><script type="module">
import { RainyAudio } from '/audio.js';
window.states = [];
window.engine = new RainyAudio({onState: state => states.push(state)});
document.querySelector('button').onclick = () => engine.setEnabled(true);
window.measure = async () => {
  const ctx = engine._ctx;
  const analyser = ctx.createAnalyser();
  const silent = ctx.createGain();
  analyser.fftSize = 2048;
  silent.gain.value = 0;
  engine._gate.connect(analyser);
  analyser.connect(silent).connect(ctx.destination);
  await new Promise(resolve => setTimeout(resolve, 150));
  const data = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(data);
  engine._gate.disconnect(analyser);
  analyser.disconnect();
  silent.disconnect();
  return {rms: Math.sqrt(data.reduce((sum, x) => sum + x*x, 0) / data.length), peak: Math.max(...data.map(Math.abs))};
};
</script>`;

(async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/audio.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/audio.js' ? code : html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const errors = [];
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.engine);
    assert.equal(await page.evaluate(() => engine.getState().status), 'off');
    await page.click('#start');
    await page.waitForFunction(() => engine.getState().playing);
    await page.waitForTimeout(1800);
    const rain = await page.evaluate(() => measure());
    assert.ok(rain.rms > 0.002 && rain.peak < 0.9, `rain is audible and unclipped: ${JSON.stringify(rain)}`);
    console.log('PASS native Web Audio produces bounded nonzero rain', rain);
    await page.evaluate(() => engine.update({ scene: 'sofa', rain: 0, tv: 0.8, master: 0.75, tvOn: true }));
    await page.waitForTimeout(3000);
    const tv = await page.evaluate(() => measure());
    assert.ok(tv.rms > 0.002 && tv.peak < 0.9, `TV is audible and unclipped: ${JSON.stringify(tv)}`);
    console.log('PASS original TV sound produces nonzero native output', tv);
    await page.evaluate(() => engine.update({ tvOn: false }));
    await page.waitForTimeout(1300);
    const muted = await page.evaluate(() => measure());
    assert.ok(muted.rms < 0.0001, `TV off silences reverb as well: ${JSON.stringify(muted)}`);
    console.log('PASS TV off silences the whole TV path', muted);
    await page.evaluate(async () => { await engine.handleVisibility(true); await engine.handleVisibility(false); });
    assert.equal(await page.evaluate(() => engine.getState().status), 'paused');
    assert.equal(await page.evaluate(() => engine._ctx.state), 'suspended');
    await page.click('#start');
    await page.waitForFunction(() => engine.getState().playing);
    await page.evaluate(() => engine.setEnabled(false));
    assert.equal(await page.evaluate(() => engine._ctx.state), 'suspended');
    await page.evaluate(() => engine.destroy());
    assert.equal(await page.evaluate(() => engine._ctx.state), 'closed');
    assert.deepEqual(errors, []);
    console.log('PASS native gesture resume, visibility pause, user pause, destroy, and no browser errors');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
