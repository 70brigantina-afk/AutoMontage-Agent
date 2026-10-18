const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createOrOpenProject, readProjectManifest, writeProjectManifest } = require('../scripts/project/workspace');
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

test('граница: рост ровно 0,3 допустим, 7,0 → 7,2 – остановка «оценка перестала расти»', () => {
  const flat = (v) => ({ idea: v, composition: v, motion: v, typography: v, rhythm: v });
  const withScores = (rep, list) => {
    rep.scenes.forEach((s, i) => { s.scores = { ...list[i] }; s.issues = [{ text: 'a', fix: 'b' }]; });
    return rep;
  };
  const first = report([7, 7]);
  // 7,0 → 7,3: сцены 7,6 и 7,0 дают среднее 7,3
  const exact = withScores(report([7, 7], { round: 2 }), [{ idea: 9, composition: 9, motion: 8, typography: 7, rhythm: 5 }, flat(7)]);
  assert.equal(sceneScore(exact.scenes[0]), 7.6);
  assert.equal(overallScore(exact), 7.3);
  assert.equal(criticDecision([first, exact]).action, 'fix');
  // 7,0 → 7,2: сцены 7,4 и 7,0
  const slow = withScores(report([7, 7], { round: 2 }), [{ idea: 8, composition: 8, motion: 8, typography: 7, rhythm: 6 }, flat(7)]);
  assert.equal(overallScore(slow), 7.2);
  const d = criticDecision([first, slow]);
  assert.equal(d.action, 'stop');
  assert.match(d.reason, /перестала расти/u);
});

test('граница: общая ровно 9,0 и сцена ровно 7,0 – остановка «цель достигнута»', () => {
  const three = report([10, 10, 7]);
  assert.equal(overallScore(three), 9);
  const d = criticDecision([three]);
  assert.equal(d.action, 'stop');
  assert.match(d.reason, /цель достигнута/u);
});

test('overall считается от целых десятых: (8,4 + 8,6) / 2 = 8,5', () => {
  const a = scene('a', 8, 0, { scores: { idea: 8, composition: 9, motion: 8, typography: 9, rhythm: 8 } });
  const b = scene('b', 8, 2, { scores: { idea: 9, composition: 9, motion: 9, typography: 8, rhythm: 8 } });
  assert.equal(sceneScore(a), 8.4);
  assert.equal(sceneScore(b), 8.6);
  assert.equal(overallScore({ scenes: [a, b] }), 8.5);
});

test('fromSec и toSec: NaN и строка – ошибка; лишняя ось в scores – ошибка', () => {
  const r = report([9, 9, 9]);
  r.scenes[0].fromSec = NaN;
  r.scenes[1].toSec = '2';
  r.scenes[2].scores.extra = 9;
  const text = validateCriticReport(r).errors.join('\n');
  assert.match(text, /s1.*fromSec/u);
  assert.match(text, /s2.*toSec/u);
  assert.match(text, /s3.*extra/u);
});

// Минимальный проект без ffmpeg: project.json с currentPreview и пустыми файлами, на которые он ссылается.
function scaffold(t, sha = SHA) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'critic-project-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source.mp4');
  fs.writeFileSync(source, 'fake');
  const projectDir = path.join(root, 'projects', 'critic-fixture');
  const workspace = createOrOpenProject({ projectDir, name: 'critic fixture', sourcePath: source });
  fs.mkdirSync(path.join(projectDir, 'previews'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, 'brief'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'previews', 'preview.mp4'), '');
  fs.writeFileSync(path.join(projectDir, 'brief', 'v01-draft.lesson.json'), '{}');
  setSha(projectDir, workspace.manifest, sha);
  return projectDir;
}

function setSha(projectDir, manifest, sha) {
  const next = {
    ...manifest,
    currentPreview: {
      filePath: 'previews/preview.mp4', briefPath: 'brief/v01-draft.lesson.json', kind: 'full', fromSec: 0, toSec: 2,
      width: 540, height: 960, fps: 25, generatedAt: new Date().toISOString(), sha256: sha,
    },
  };
  writeProjectManifest(projectDir, next, { expectedManifest: manifest });
}

// Каждый круг критика перерендеривает preview: тест имитирует это сменой sha в project.json.
function rerender(projectDir, sha) {
  setSha(projectDir, readProjectManifest(projectDir), sha);
}

function runCli(projectDir, rep) {
  const file = path.join(projectDir, `in-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify(rep));
  const out = []; const err = [];
  return main(['--project-dir', projectDir, '--report', file], { log: (m) => out.push(m), error: (m) => err.push(m) })
    .then((code) => ({ code, out: out.join('\n'), err: err.join('\n') }));
}

const readSaved = (projectDir, name) => JSON.parse(fs.readFileSync(path.join(projectDir, 'qa', name), 'utf8'));

test('CLI: чужой sha даёт код 2, ничего не сохраняет и не печатает решения', async (t) => {
  const projectDir = scaffold(t);
  const res = await runCli(projectDir, report([6, 6], { previewSha256: OTHER_SHA }));
  assert.equal(res.code, 2);
  assert.match(res.err, /другому preview/u);
  assert.equal(fs.existsSync(path.join(projectDir, 'qa')), false);
  assert.doesNotMatch(res.out, /Решение/u);
});

test('CLI: невалидный отчёт даёт код 2 со списком проблем', async (t) => {
  const projectDir = scaffold(t);
  const bad = report([9, 9]);
  bad.scenes[1].scores.rhythm = 11;
  const res = await runCli(projectDir, bad);
  assert.equal(res.code, 2);
  assert.match(res.err, /s2.*rhythm/u);
  assert.equal(fs.existsSync(path.join(projectDir, 'qa')), false);
});

test('CLI: два вызова подряд дают critic-01 и critic-02 и печатают решение', async (t) => {
  const projectDir = scaffold(t);
  const first = await runCli(projectDir, report([6, 7, 9]));
  assert.equal(first.code, 0);
  assert.match(first.out, /исправ/iu);
  assert.ok(fs.existsSync(path.join(projectDir, 'qa', 'critic-01.json')));
  assert.ok(fs.existsSync(path.join(projectDir, 'qa', 'critic-01.txt')));
  rerender(projectDir, OTHER_SHA);
  const second = await runCli(projectDir, report([8, 8, 9], { round: 1, previewSha256: OTHER_SHA }));
  assert.equal(second.code, 0);
  assert.match(second.err, /круг/u);
  const saved = readSaved(projectDir, 'critic-02.json');
  assert.equal(saved.report.round, 2);
  assert.equal(saved.decision.action, 'fix');
  assert.match(fs.readFileSync(path.join(projectDir, 'qa', 'critic-02.txt'), 'utf8'), /s1/u);
});

test('CLI: цепочка кругов идёт через смену sha preview; третий круг останавливает, после стопа круг 1 в новом файле', async (t) => {
  const projectDir = scaffold(t, 'a'.repeat(64));
  const shas = ['b', 'c', 'd'].map((c) => c.repeat(64));
  const r1 = await runCli(projectDir, report([6, 7, 9], { round: 1, previewSha256: SHA }));
  assert.equal(r1.code, 0);
  rerender(projectDir, shas[0]);
  const r2 = await runCli(projectDir, report([7, 8, 9], { round: 2, previewSha256: shas[0] }));
  assert.equal(r2.code, 0);
  assert.equal(r2.err, '');
  const second = readSaved(projectDir, 'critic-02.json');
  assert.equal(second.report.round, 2);
  assert.equal(second.decision.action, 'fix');
  assert.match(second.decision.reason, /общая оценка 8/u);
  rerender(projectDir, shas[1]);
  const r3 = await runCli(projectDir, report([8, 8, 9], { round: 3, previewSha256: shas[1] }));
  assert.equal(r3.code, 0);
  const third = readSaved(projectDir, 'critic-03.json');
  assert.equal(third.report.round, 3);
  assert.equal(third.decision.action, 'stop');
  assert.match(third.decision.reason, /третий круг/u);
  rerender(projectDir, shas[2]);
  const r4 = await runCli(projectDir, report([6, 7, 9], { round: 1, previewSha256: shas[2] }));
  assert.equal(r4.code, 0);
  assert.equal(r4.err, '');
  const fourth = readSaved(projectDir, 'critic-04.json');
  assert.equal(fourth.report.round, 1);
  assert.equal(fourth.decision.action, 'fix');
  assert.equal(readSaved(projectDir, 'critic-03.json').decision.action, 'stop');
});

test('CLI: повторный отчёт к тому же preview отклоняется, ничего не сохраняется', async (t) => {
  const projectDir = scaffold(t);
  assert.equal((await runCli(projectDir, report([6, 7, 9]))).code, 0);
  const again = await runCli(projectDir, report([8, 8, 9], { round: 2 }));
  assert.equal(again.code, 2);
  assert.match(again.err, /уже сохранён \(critic-01\).*перерендерьте/u);
  assert.equal(fs.existsSync(path.join(projectDir, 'qa', 'critic-02.json')), false);
  rerender(projectDir, OTHER_SHA);
  assert.equal((await runCli(projectDir, report([8, 8, 9], { round: 2, previewSha256: OTHER_SHA }))).code, 0);
});

test('CLI: нечитаемый critic-NN.json даёт предупреждение с именем файла и не затирается', async (t) => {
  const projectDir = scaffold(t);
  fs.mkdirSync(path.join(projectDir, 'qa'));
  fs.writeFileSync(path.join(projectDir, 'qa', 'critic-01.json'), '{сломано');
  const res = await runCli(projectDir, report([6, 7, 9]));
  assert.equal(res.code, 0);
  assert.match(res.err, /critic-01\.json/u);
  assert.equal(fs.readFileSync(path.join(projectDir, 'qa', 'critic-01.json'), 'utf8'), '{сломано');
  assert.equal(readSaved(projectDir, 'critic-02.json').report.round, 1);
});

test('CLI: номер файла – максимальный существующий плюс один, пропуски не заполняются', async (t) => {
  const projectDir = scaffold(t);
  const first = await runCli(projectDir, report([6, 7, 9]));
  assert.equal(first.code, 0);
  fs.renameSync(path.join(projectDir, 'qa', 'critic-01.json'), path.join(projectDir, 'qa', 'critic-05.json'));
  rerender(projectDir, OTHER_SHA);
  const second = await runCli(projectDir, report([7, 8, 9], { round: 2, previewSha256: OTHER_SHA }));
  assert.equal(second.code, 0);
  assert.ok(fs.existsSync(path.join(projectDir, 'qa', 'critic-06.json')));
  assert.equal(readSaved(projectDir, 'critic-06.json').report.round, 2);
});
