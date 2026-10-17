// Строка «Утверждено» во входящих пульта значит: approveBrief уже выполнен – собирай final.
// Навык, который велит снова звать approve-brief.js, ведёт агента в отказ (текущий brief уже не draft).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

for (const skill of ['reel-turnkey', 'motion-reel', 'ai-promo']) {
  test(`${skill}: pult approval goes straight to final without a second approve`, () => {
    const text = fs.readFileSync(path.join(ROOT, 'skills', skill, 'SKILL.md'), 'utf8');
    assert.match(text, /«Утверждаю» в пульте[^]{0,120}«Утверждено»/u);
    assert.match(text, /approveBrief` уже выполнен/u);
  });
}
