const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { toolAvailable } = require('./helpers/media-fixtures');
const { makeLayerProject } = require('./helpers/layer-project');
const { writeProjectManifest } = require('../scripts/project/workspace');
const { validateCriticReport, sceneScore, overallScore, criticDecision, main } = require('../scripts/qa/critic');

const SHA = 'a'.repeat(64);
const OTHER_SHA = 'b'.repeat(64);

function scene(ref, score, fromSec = 0, extra = {}) {
  return {
    ref, fromSec, toSec: fromSec + 2,
    scores: { idea: score, composition: score, motion: score, typography: score, rhythm: score },
    issues: score < 9 ? [{ text: 'слабо', fix: 'усилить' }] : [],
    ...extra,
  };
}
const report = (scores, { round = 1, previewSha256 = SHA } = {}) => ({
  version: 1, round, previewSha256, summary: 'итог',
  scenes: scores.map((s, i) => scene(`s${i + 1}`, s, i * 2)),
});

test('валидный отчёт проходит, оценки считаются с округлением до 0,1', () => {
  const r = report([9, 9]);
  assert.deepEqual(validateCriticReport(r), { ok: true, errors: [] });
  const mixed = scene('m', 8, 0, { scores: { idea: 8, composition: 9, motion: 8, typography: 9, rhythm: 8 } });
  assert.equal(sceneScore(mixed), 8.4);
  assert.equal(overallScore({ scenes: [mixed, scene('n', 9)] }), 8.7);
});

test('оценки 0, 11, 7.5 и пропущенная ось дают ошибки с именем сцены и оси', () => {
  const r = report([9, 9, 9, 9]);
  r.scenes[0].scores.idea = 0;
  r.scenes[1].scores.motion = 11;
  r.scenes[2].scores.typography = 7.5;
  delete r.scenes[3].scores.rhythm;
  const { ok, errors } = validateCriticReport(r);
  assert.equal(ok, false);
  const text = errors.join('\n');
  assert.match(text, /s1.*idea/u);
  assert.match(text, /s2.*motion/u);
  assert.match(text, /s3.*typography/u);
  assert.match(text, /s4.*rhythm/u);
});

test('сцена с оценкой 6 без правок отклоняется, лишние ключи и пустой отчёт тоже', () => {
  const r = report([6, 9]);
  r.scenes[0].issues = [];
  const { ok, errors } = validateCriticReport(r);
  assert.equal(ok, false);
  assert.match(errors.join('\n'), /s1.*правк/u);
  assert.equal(validateCriticReport({ ...report([9]), scenes: [] }).ok, false);
  assert.equal(validateCriticReport(null).ok, false);
  assert.equal(validateCriticReport({ ...report([9]), round: 4 }).ok, false);
});

test('общая 9,2 и все сцены не ниже 7: остановка «цель достигнута»', () => {
  const d = criticDecision([report([9, 9, 9, 10, 9])]);
  assert.equal(d.action, 'stop');
  assert.match(d.reason, /цель достигнута/u);
  assert.equal(d.overall, 9.2);
});

test('общая выше 9, но сцена 6,4: исправлять', () => {
  const r = report([10, 10, 10, 10, 10, 10, 10, 10, 10, 10]);
  r.scenes[0].scores = { idea: 6, composition: 7, motion: 6, typography: 7, rhythm: 6 };
  r.scenes[0].issues = [{ text: 'a', fix: 'b' }];
  const d = criticDecision([r]);
  assert.ok(d.overall >= 9);
  assert.equal(d.action, 'fix');
  assert.deepEqual(d.worst, ['s1']);
});

test('круг 3: остановка', () => {
  const d = criticDecision([report([5, 5], { round: 1 }), report([6, 6], { round: 2 }), report([8, 8], { round: 3 })]);
  assert.equal(d.action, 'stop');
  assert.match(d.reason, /третий круг/u);
});

test('рост меньше 0,3 (7,0 → 7,1): остановка «оценка перестала расти»; рост 0,6 допустим', () => {
  const withScores = (rep, scores) => {
    rep.scenes.forEach((s, i) => { s.scores = { ...scores[i] }; s.issues = [{ text: 'a', fix: 'b' }]; });
    return rep;
  };
  const flat = (v) => ({ idea: v, composition: v, motion: v, typography: v, rhythm: v });
  const first = report([7, 7]);
  const slow = withScores(report([7, 7], { round: 2 }), [{ ...flat(7), rhythm: 8 }, flat(7)]);
  const stop = criticDecision([first, slow]);
  assert.equal(stop.overall, 7.1);
  assert.equal(stop.action, 'stop');
  assert.match(stop.reason, /перестала расти/u);
  const fast = withScores(report([7, 7], { round: 2 }), [{ ...flat(7), idea: 8, motion: 8, rhythm: 8 }, { ...flat(7), idea: 8, motion: 8, rhythm: 8 }]);
  assert.equal(overallScore(fast), 7.6);
  assert.equal(criticDecision([first, fast]).action, 'fix');
});

test('worst: три наименьшие сцены, при равенстве более ранняя; сцены от 9 не кандидаты', () => {
  const d = criticDecision([report([6, 8, 6, 5, 6, 9])]);
  assert.equal(d.action, 'fix');
  assert.deepEqual(d.worst, ['s4', 's1', 's3']);
});

test('worst: меньше трёх сцен и дубли ref не роняют решение', () => {
  assert.deepEqual(criticDecision([report([6, 8])]).worst, ['s1', 's2']);
  const r = report([6, 6, 9]);
  r.scenes[1].ref = 's1';
  assert.deepEqual(criticDecision([r]).worst, ['s1']);
});

const hasFfmpeg = toolAvailable('ffmpeg') && toolAvailable('ffprobe');

function scaffold(t) {
  const { projectDir, workspace } = makeLayerProject(t, { seconds: 2 });
  const next = {
    ...workspace.manifest,
    currentPreview: {
      filePath: 'previews/preview.mp4', briefPath: 'brief/v01-draft.lesson.json', kind: 'full', fromSec: 0, toSec: 2,
      width: 540, height: 960, fps: 25, generatedAt: new Date().toISOString(), sha256: SHA,
    },
  };
  writeProjectManifest(projectDir, next, { expectedManifest: workspace.manifest });
  return projectDir;
}

function runCli(projectDir, rep) {
  const file = path.join(projectDir, `in-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify(rep));
  const out = []; const err = [];
  return main(['--project-dir', projectDir, '--report', file], { log: (m) => out.push(m), error: (m) => err.push(m) })
    .then((code) => ({ code, out: out.join('\n'), err: err.join('\n') }));
}

test('CLI: чужой sha даёт код 2, ничего не сохраняет и не печатает решения', { skip: !hasFfmpeg }, async (t) => {
  const projectDir = scaffold(t);
  const res = await runCli(projectDir, report([6, 6], { previewSha256: OTHER_SHA }));
  assert.equal(res.code, 2);
  assert.match(res.err, /другому preview/u);
  assert.equal(fs.existsSync(path.join(projectDir, 'qa')), false);
  assert.doesNotMatch(res.out, /Решение/u);
});

test('CLI: невалидный отчёт даёт код 2 со списком проблем', { skip: !hasFfmpeg }, async (t) => {
  const projectDir = scaffold(t);
  const bad = report([9, 9]);
  bad.scenes[1].scores.rhythm = 11;
  const res = await runCli(projectDir, bad);
  assert.equal(res.code, 2);
  assert.match(res.err, /s2.*rhythm/u);
  assert.equal(fs.existsSync(path.join(projectDir, 'qa')), false);
});

test('CLI: два вызова подряд дают critic-01 и critic-02 и печатают решение', { skip: !hasFfmpeg }, async (t) => {
  const projectDir = scaffold(t);
  const first = await runCli(projectDir, report([6, 7, 9]));
  assert.equal(first.code, 0);
  assert.match(first.out, /fix|исправ/iu);
  assert.ok(fs.existsSync(path.join(projectDir, 'qa', 'critic-01.json')));
  assert.ok(fs.existsSync(path.join(projectDir, 'qa', 'critic-01.txt')));
  const second = await runCli(projectDir, report([8, 8, 9], { round: 1 }));
  assert.equal(second.code, 0);
  assert.match(second.err, /круг/u);
  assert.ok(fs.existsSync(path.join(projectDir, 'qa', 'critic-02.json')));
  const saved = JSON.parse(fs.readFileSync(path.join(projectDir, 'qa', 'critic-02.json'), 'utf8'));
  assert.equal(saved.report.round, 2);
  assert.equal(saved.decision.action, 'fix');
  assert.match(fs.readFileSync(path.join(projectDir, 'qa', 'critic-02.txt'), 'utf8'), /s1/u);
});
