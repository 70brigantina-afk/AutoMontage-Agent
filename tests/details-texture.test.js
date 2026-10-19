const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { loadMotion, brief } = require('./helpers/motion-render');
const { validateMotionBrief } = require('../scripts/motion/brief');

const ROOT = path.join(__dirname, '..');
const GRAIN = path.join(ROOT, 'public/textures/grain-256.png');
const math = () => loadMotion('src/details/texture.js');
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('grainOffset is stable for two frames, changes every second step, and repeats between runs', () => {
  const { grainOffset } = math();
  assert.deepEqual(grainOffset(10), grainOffset(11));
  assert.notDeepEqual(grainOffset(10), grainOffset(12));
  assert.deepEqual(grainOffset(40), math().grainOffset(40));
  const { x, y } = grainOffset(10);
  assert.ok(Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < 256 && y >= 0 && y < 256);
  assert.notDeepEqual(grainOffset(10, { seed: 8 }), grainOffset(10));
});

test('driftAt loops after 8 seconds and never exceeds the amplitude', () => {
  const { driftAt } = math();
  for (const fps of [25, 30]) {
    const a = driftAt(0, fps);
    const b = driftAt(8 * fps, fps);
    assert.ok(Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9);
    for (let frame = 0; frame < 20 * fps; frame += 1) {
      const d = driftAt(frame, fps);
      assert.ok(Math.abs(d.x) <= 0.06 + 1e-12 && Math.abs(d.y) <= 0.06 + 1e-12);
    }
  }
  assert.ok(Math.abs(driftAt(2 * 25, 25).x) > 0.01);
});

test('sheenProgress is null outside one 12-frame pass at 25 fps and scales with fps', () => {
  const { sheenProgress } = math();
  assert.equal(sheenProgress(4, 25, 5), null);
  assert.equal(sheenProgress(5 + 12, 25, 5), null);
  assert.equal(sheenProgress(5, 25, 5), 0);
  const mid = sheenProgress(11, 25, 5);
  assert.ok(mid > 0 && mid < 1);
  assert.notEqual(sheenProgress(5 + 13, 30, 5), null);
  assert.equal(sheenProgress(5 + 14, 30, 5), null);
});

test('gen-grain is deterministic and the tracked tile matches the generator', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grain-'));
  try {
    const a = path.join(dir, 'a.png');
    const b = path.join(dir, 'b.png');
    execFileSync(process.execPath, [path.join(ROOT, 'scripts/gen-grain.js'), a]);
    execFileSync(process.execPath, [path.join(ROOT, 'scripts/gen-grain.js'), b]);
    assert.equal(sha(a), sha(b));
    assert.equal(sha(a), sha(GRAIN));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function decodeGray(file) {
  const png = fs.readFileSync(file);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  assert.deepEqual([width, height, png[24], png[25]], [256, 256, 8, 0]);
  let offset = 8;
  const idat = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    if (png.subarray(offset + 4, offset + 8).toString() === 'IDAT') idat.push(png.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const pixels = [];
  for (let row = 0; row < height; row += 1) {
    assert.equal(raw[row * (width + 1)], 0);
    for (let col = 0; col < width; col += 1) pixels.push(raw[row * (width + 1) + 1 + col]);
  }
  return pixels;
}

const luminance = (rgb) => {
  const lin = rgb.map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
};
const hex = (value) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('grain at 0.06 keeps ink contrast above 4.5 on the panel and on the light background (worst tile pixel)', () => {
  const { motionTheme } = loadMotion('src/motion/motion-theme.js');
  const { GRAIN_OPACITY } = math();
  assert.ok(GRAIN_OPACITY <= 0.06);
  const pixels = decodeGray(GRAIN);
  const levels = [Math.min(...pixels), Math.max(...pixels)];
  for (const base of [motionTheme.panel, motionTheme.background]) {
    for (const level of levels) {
      const mixed = hex(base).map((c) => c * (1 - GRAIN_OPACITY) + level * GRAIN_OPACITY);
      assert.ok(contrast(hex(motionTheme.ink), mixed) >= 4.5, `${base} with grain ${level}`);
    }
  }
});

const render = (props, overrides) => {
  const { MotionDirector } = loadMotion('src/MotionDirector.jsx', overrides);
  return renderToStaticMarkup(React.createElement(MotionDirector, props));
};
const cardScene = { scene: 'card', title: 'Заголовок', body: 'Текст', start: 0, end: 3 };

test('brief schema: style.texture is optional none|subtle', () => {
  const base = brief({ scenes: [cardScene] });
  assert.equal(validateMotionBrief(base).ok, true);
  assert.equal(validateMotionBrief({ ...base, style: { texture: 'subtle' } }).ok, true);
  assert.equal(validateMotionBrief({ ...base, style: { texture: 'none' } }).ok, true);
  assert.equal(validateMotionBrief({ ...base, style: {} }).ok, true);
  assert.equal(validateMotionBrief({ ...base, style: { texture: 'heavy' } }).ok, false);
  assert.equal(validateMotionBrief({ ...base, style: { texture: 'subtle', extra: 1 } }).ok, false);
});

test('without style.texture there is no Grain, Drift or Sheen', () => {
  for (const props of [{ scenes: [cardScene] }, { scenes: [cardScene], style: { texture: 'none' } }]) {
    assert.doesNotMatch(render(props), /data-texture-/);
    assert.doesNotMatch(render(props, { useCurrentFrame: () => 4 }), /data-texture-/);
  }
});

test('subtle puts Drift and Grain before the scene container, under the text', () => {
  const html = render({ scenes: [cardScene], style: { texture: 'subtle' } });
  const drift = html.indexOf('data-texture-drift');
  const grain = html.indexOf('data-texture-grain');
  const scene = html.indexOf('data-motion-safe');
  assert.ok(drift >= 0 && grain > drift && scene > grain);
  assert.match(html, /url\(data:image\/png;base64,/);
  assert.doesNotMatch(html, /grain-256\.png/);
});

test('Sheen appears on a card entry only when texture is subtle', () => {
  const entering = { useCurrentFrame: () => 4 };
  assert.match(render({ scenes: [cardScene], style: { texture: 'subtle' } }, entering), /data-texture-sheen/);
  assert.doesNotMatch(render({ scenes: [cardScene] }, entering), /data-texture-sheen/);
  assert.doesNotMatch(render({ scenes: [cardScene], style: { texture: 'subtle' } }), /data-texture-sheen/);
});

test('motion-kit exports the texture parts', () => {
  const kit = loadMotion('src/motion-kit/index.js');
  for (const name of ['Grain', 'Drift', 'Sheen', 'grainOffset', 'driftAt', 'sheenProgress']) assert.ok(kit[name], name);
});

test('Grain uses an inlined data URI byte-identical to the tracked PNG (isolated render public dir has no textures)', () => {
  const html = render({ scenes: [cardScene], style: { texture: 'subtle' } });
  const uri = /url\((data:image\/png;base64,[A-Za-z0-9+/=]+)\)/.exec(html);
  assert.ok(uri, 'grain background is a data URI');
  const bytes = Buffer.from(uri[1].split(',')[1], 'base64');
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), sha(GRAIN));
  const { GRAIN_DATA_URI } = loadMotion('src/details/grain-data.js');
  assert.equal(GRAIN_DATA_URI, uri[1]);
});

test('gen-grain rerun keeps the PNG and the generated module identical', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grain-'));
  try {
    const run = (n) => {
      const png = path.join(dir, `${n}.png`);
      const mod = path.join(dir, `${n}.js`);
      execFileSync(process.execPath, [path.join(ROOT, 'scripts/gen-grain.js'), png, mod]);
      return [fs.readFileSync(png), fs.readFileSync(mod)];
    };
    const [pngA, modA] = run('a');
    const [pngB, modB] = run('b');
    assert.ok(pngA.equals(pngB) && modA.equals(modB));
    assert.ok(modA.equals(fs.readFileSync(path.join(ROOT, 'src/details/grain-data.js'))));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('muted, ink and accent text stay >= 4.5 over the worst Drift blend plus worst grain pixel', () => {
  const { motionTheme } = loadMotion('src/motion/motion-theme.js');
  const { DRIFT_COLOR_KEYS, DRIFT_OPACITY, GRAIN_OPACITY } = math();
  const pixels = decodeGray(GRAIN);
  const levels = [Math.min(...pixels), Math.max(...pixels)];
  const mix = (base, color) => base.map((c, i) => c * (1 - DRIFT_OPACITY) + color[i] * DRIFT_OPACITY);
  const [first, second] = DRIFT_COLOR_KEYS.map((key) => hex(motionTheme[key]));
  const bg = hex(motionTheme.background);
  const blends = [mix(bg, first), mix(bg, second), mix(mix(bg, first), second)];
  for (const blend of blends) for (const level of levels) {
    const pixel = blend.map((c) => c * (1 - GRAIN_OPACITY) + level * GRAIN_OPACITY);
    for (const name of ['muted', 'ink', 'accent']) {
      assert.ok(contrast(hex(motionTheme[name]), pixel) >= 4.5, `${name} over ${blend} grain ${level}`);
    }
  }
});

test('Sheen is painted before the card content and the content sits above it', () => {
  const html = render({ scenes: [cardScene], style: { texture: 'subtle' } }, { useCurrentFrame: () => 4 });
  const sheen = html.indexOf('data-texture-sheen');
  const content = html.indexOf('data-panel-content');
  assert.ok(sheen >= 0 && content > sheen, 'sheen precedes content in DOM');
  const tag = html.slice(html.lastIndexOf('<', content), html.indexOf('>', content));
  assert.match(tag, /position:relative/);
  assert.match(tag, /z-index:1/);
});
