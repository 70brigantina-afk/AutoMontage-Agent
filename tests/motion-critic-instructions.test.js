const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const CRITIC_DOC = 'skills/reel-turnkey/references/motion-critic.md';
const AGENT = '.claude/agents/motion-critic.md';
const ROUTES = [
  'skills/reel-turnkey/SKILL.md',
  'skills/motion-reel/SKILL.md',
  'skills/reel-from-donor/SKILL.md',
  'skills/ai-promo/SKILL.md',
];

test('motion-critic: задание содержит оси, правило JSON и ссылки', () => {
  const doc = read(CRITIC_DOC);
  for (const axis of ['idea', 'composition', 'motion', 'typography', 'rhythm']) {
    assert.ok(doc.includes(`\`${axis}\``), axis);
  }
  assert.match(doc, /только JSON/u);
  assert.ok(doc.includes('motion-craft.md'));
  assert.ok(doc.includes('schema/critic-report.schema.json'));
  assert.ok(doc.includes('moments-'));
  assert.match(doc, /\bfix\b/u);
  assert.match(doc, /\bref\b/u);
  assert.match(doc, /1, 5 и 10|1, 5 и 10/u);
});

test('motion-critic: субагент только читает и ссылается на канон', () => {
  const agent = read(AGENT);
  assert.match(agent, /^---\nname: motion-critic\n/u);
  assert.match(agent, /^description: .+$/mu);
  assert.match(agent, /^tools: Read, Glob, Grep$/mu);
  assert.ok(agent.includes('skills/reel-turnkey/references/motion-critic.md'));
});

test('motion-critic: четыре маршрута Creative Motion содержат цикл критика', () => {
  for (const route of ROUTES) {
    const text = read(route);
    assert.ok(text.includes('layer sheet --mode moments'), `${route}: layer sheet --mode moments`);
    assert.ok(text.includes('automontage critic'), `${route}: automontage critic`);
    assert.ok(text.includes('motion-critic'), `${route}: motion-critic`);
    assert.match(text, /Цикл критика/u, route);
  }
});

// Шаг рендера preview в каждом маршруте: слой kit – «layer import → layer brief → preview», ai-promo – «**Preview.**».
const PREVIEW_STEP = {
  'skills/reel-turnkey/SKILL.md': '`automontage layer import` → `automontage layer brief` → `automontage preview`',
  'skills/motion-reel/SKILL.md': '`automontage layer import` → `automontage layer brief` → `automontage preview`',
  'skills/reel-from-donor/SKILL.md': '`automontage layer import` → `automontage layer brief` → `automontage preview`',
  'skills/ai-promo/SKILL.md': '**Preview.**',
};

test('motion-critic: цикл критика идёт до рендера preview, видео внутри цикла не рендерится', () => {
  for (const route of ROUTES) {
    const text = read(route);
    const critic = text.indexOf('**Цикл критика**');
    const preview = text.indexOf(PREVIEW_STEP[route]);
    assert.ok(critic >= 0, `${route}: шаг критика`);
    assert.ok(preview >= 0, `${route}: шаг preview`);
    assert.ok(critic < preview, `${route}: шаг критика должен стоять раньше рендера preview`);
    assert.ok(text.includes('рендер видео внутри цикла запрещён'), `${route}: запрет рендера видео в цикле`);
    assert.match(text, /один раз после `stop`/u, `${route}: preview один раз после stop`);
    assert.ok(text.includes('moments-stills-'), `${route}: индекс кадров из композиции`);
  }
});

test('motion-critic: задание критику описывает кадры из композиции и subjectSha256', () => {
  const doc = read(CRITIC_DOC);
  assert.ok(doc.includes('moments-stills-'));
  assert.ok(doc.includes('"subject": "stills"'));
  assert.ok(doc.includes('subjectSha256'));
  assert.ok(doc.includes('inputsSha256'));
  assert.ok(!doc.includes('"previewSha256"'), 'пример отчёта в новом формате');
});

test('motion-critic: чек-лист QA требует последнего решения stop', () => {
  const checklist = read('skills/reel-turnkey/references/qa-checklist.md');
  assert.match(checklist, /qa\/critic-\*\.txt/u);
  assert.match(checklist, /stop/u);
});

test('motion-critic: копии motion-reel равны канону', () => {
  const canon = read('skills/motion-reel/SKILL.md');
  assert.equal(read('.agents/skills/motion-reel/SKILL.md'), canon);
  assert.equal(read('.codex/skills/motion-reel/SKILL.md'), canon);
});

test('motion-critic: документы без длинного тире и личных путей', () => {
  // В старых маршрутах длинное тире уже было до цикла критика, поэтому тире проверяем только в новых документах.
  const fresh = [CRITIC_DOC, AGENT, 'skills/reel-turnkey/references/qa-checklist.md'];
  for (const file of [...fresh, ...ROUTES]) {
    const text = read(file);
    if (fresh.includes(file)) assert.ok(!text.includes('—'), `${file}: U+2014`);
    assert.ok(!/\/Users\/|\/home\//u.test(text), `${file}: личный путь`);
  }
});
