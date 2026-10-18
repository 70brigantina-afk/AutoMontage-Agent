// Отчёт агента-критика: проверка JSON, оценки, решение «исправлять или остановиться» и команда
// `automontage critic`. Критик только читает кадры и пишет отчёт; правит и рендерит сборщик.
// Схема – schema/critic-report.schema.json; правила остановки – в criticDecision.
const fs = require('node:fs');
const path = require('node:path');
const { readProjectManifest } = require('../project/workspace');
const { projectQaDir, writeReport } = require('./report');

const AXES = ['idea', 'composition', 'motion', 'typography', 'rhythm'];
const AXIS_TITLES = { idea: 'идея', composition: 'композиция', motion: 'движение', typography: 'типографика', rhythm: 'ритм' };
const MAX_ROUND = 3;
const TARGET = 9;
const MIN_SCENE = 7;
const MIN_GROWTH_TENTHS = 3;
const WORST_COUNT = 3;
const USAGE = 'Использование: automontage critic --project-dir <папка> --report <файл.json>';

const tenths = (value) => Math.round(value * 10);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';
const fmt = (value) => String(value).replace('.', ',');

// Оценка сцены – среднее пяти осей, до 0,1.
function sceneScore(scene) {
  const sum = AXES.reduce((acc, axis) => acc + scene.scores[axis], 0);
  return tenths(sum / AXES.length) / 10;
}

// Общая оценка круга – среднее оценок сцен, до 0,1.
function overallScore(report) {
  // Складываем целые десятые, а не уже округлённые дроби: (8,4 + 8,5) / 2 даёт 8,5, а не 8,4.
  const sum = report.scenes.reduce((acc, scene) => acc + tenths(sceneScore(scene)), 0);
  return Math.round(sum / report.scenes.length) / 10;
}

function validateCriticReport(report) {
  const errors = [];
  if (!isObject(report)) return { ok: false, errors: ['отчёт должен быть JSON-объектом'] };
  if (report.version !== 1) errors.push('version должен быть 1');
  if (!Number.isInteger(report.round) || report.round < 1 || report.round > MAX_ROUND) errors.push(`round должен быть целым от 1 до ${MAX_ROUND}`);
  if (typeof report.previewSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(report.previewSha256)) errors.push('previewSha256 должен быть sha256 (64 символа a-f0-9)');
  if (!isText(report.summary)) errors.push('summary: нужен непустой текст');
  if (!Array.isArray(report.scenes) || report.scenes.length === 0) {
    errors.push('scenes: нужна минимум одна сцена');
    return { ok: false, errors };
  }
  report.scenes.forEach((scene, index) => {
    const label = isObject(scene) && isText(scene.ref) ? `сцена «${scene.ref}»` : `сцена №${index + 1}`;
    if (!isObject(scene)) { errors.push(`${label}: должна быть объектом`); return; }
    if (!isText(scene.ref)) errors.push(`${label}: нужен ref`);
    if (typeof scene.fromSec !== 'number' || !(scene.fromSec >= 0)) errors.push(`${label}: fromSec должен быть числом от 0`);
    if (typeof scene.toSec !== 'number' || !(scene.toSec > 0)) errors.push(`${label}: toSec должен быть числом больше 0`);
    let scoresOk = isObject(scene.scores);
    if (!scoresOk) errors.push(`${label}: нет scores`);
    else {
      for (const axis of AXES) {
        const v = scene.scores[axis];
        if (v === undefined) { errors.push(`${label}, ось ${axis}: оценка не указана`); scoresOk = false; }
        else if (!Number.isInteger(v) || v < 1 || v > 10) { errors.push(`${label}, ось ${axis}: оценка должна быть целой от 1 до 10, получено ${JSON.stringify(v)}`); scoresOk = false; }
      }
      for (const key of Object.keys(scene.scores)) if (!AXES.includes(key)) errors.push(`${label}: неизвестная ось ${key}`);
    }
    if (!Array.isArray(scene.issues)) errors.push(`${label}: issues должен быть массивом`);
    else {
      scene.issues.forEach((issue, i) => {
        if (!isObject(issue) || !isText(issue.text) || !isText(issue.fix)) errors.push(`${label}, правка №${i + 1}: нужны непустые text и fix`);
      });
      if (scoresOk && sceneScore(scene) < TARGET && scene.issues.length === 0) errors.push(`${label}: оценка ниже ${TARGET}, нужна минимум одна правка в issues`);
    }
  });
  return { ok: errors.length === 0, errors };
}

// Три худшие сцены: оценка ниже 9, по возрастанию, при равенстве раньше в отчёте; без дублей ref.
function worstScenes(report) {
  const seen = new Set();
  return report.scenes
    .map((scene, index) => ({ scene, index, score: sceneScore(scene) }))
    .filter((c) => c.score < TARGET)
    .sort((a, b) => a.score - b.score || a.scene.fromSec - b.scene.fromSec || a.index - b.index)
    .filter((c) => (seen.has(c.scene.ref) ? false : seen.add(c.scene.ref)))
    .slice(0, WORST_COUNT)
    .map((c) => c.scene.ref);
}

// history – отчёты одного preview по порядку кругов; решение принимается по последнему.
function criticDecision(history) {
  const last = history[history.length - 1];
  const overall = overallScore(last);
  const worst = worstScenes(last);
  const lowest = Math.min(...last.scenes.map(sceneScore));
  if (tenths(overall) >= tenths(TARGET) && tenths(lowest) >= tenths(MIN_SCENE)) {
    return { action: 'stop', reason: `цель достигнута: общая оценка ${fmt(overall)}, ни одной сцены ниже ${MIN_SCENE}`, overall, worst };
  }
  if (history.length >= MAX_ROUND) {
    return { action: 'stop', reason: `третий круг: общая оценка ${fmt(overall)}, больше кругов не делаем`, overall, worst };
  }
  if (history.length >= 2) {
    const previous = overallScore(history[history.length - 2]);
    if (tenths(overall) - tenths(previous) < MIN_GROWTH_TENTHS) {
      return { action: 'stop', reason: `оценка перестала расти: было ${fmt(previous)}, стало ${fmt(overall)}`, overall, worst };
    }
  }
  return { action: 'fix', reason: `общая оценка ${fmt(overall)}: исправьте худшие сцены и перерендерите preview`, overall, worst };
}

function formatCriticReport(saved) {
  const { report, decision } = saved;
  const lines = [`Критик, круг ${report.round}: общая оценка ${fmt(decision.overall)}`];
  for (const scene of report.scenes) {
    const axes = AXES.map((axis) => `${AXIS_TITLES[axis]} ${scene.scores[axis]}`).join(', ');
    lines.push(`${scene.ref} (${fmt(scene.fromSec)}-${fmt(scene.toSec)} с): ${fmt(sceneScore(scene))} (${axes})`);
  }
  lines.push('', `Решение: ${decision.action === 'fix' ? 'исправлять' : 'остановиться'} – ${decision.reason}`);
  if (decision.action === 'fix') lines.push(`Худшие сцены: ${decision.worst.join(', ')}`);
  const fixes = report.scenes.filter((s) => s.issues.length > 0 && (decision.action === 'stop' || decision.worst.includes(s.ref)));
  if (fixes.length) lines.push('', 'Правки:');
  for (const scene of fixes) for (const issue of scene.issues) lines.push(`- ${scene.ref}: ${issue.text} → ${issue.fix}`);
  lines.push('', `Итог критика: ${report.summary}`);
  return lines.join('\n');
}

const CRITIC_FILE = /^critic-(\d+)\.json$/u;

// Цепочка кругов: сохранённые critic-*.json по порядку номеров после последнего решения «остановиться».
// Каждый круг перерендеривает preview, поэтому sha в цепочке меняется и в выборе не участвует.
// next – свободный номер файла (максимальный + 1), существующие отчёты не перезаписываются.
function savedChain(projectDir, warn) {
  const dir = projectQaDir(projectDir);
  if (!dir) return { chain: [], next: 1 };
  const entries = fs.readdirSync(dir)
    .map((name) => ({ name, match: CRITIC_FILE.exec(name) }))
    .filter((e) => e.match)
    .sort((a, b) => Number(a.match[1]) - Number(b.match[1]));
  let chain = [];
  for (const entry of entries) {
    let saved = null;
    try { saved = JSON.parse(fs.readFileSync(path.join(dir, entry.name), 'utf8')); } catch { saved = null; }
    if (!isObject(saved) || !isObject(saved.report) || !Array.isArray(saved.report.scenes) || !isObject(saved.decision)) {
      warn(`⚠️ qa/${entry.name} не читается или повреждён: пропускаем его при подсчёте кругов`);
    } else if (saved.decision.action === 'stop') chain = [];
    else chain.push(saved.report);
  }
  const next = entries.length ? Number(entries[entries.length - 1].match[1]) + 1 : 1;
  return { chain, next };
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg !== '--project-dir' && arg !== '--report') throw new Error(`неизвестный аргумент «${arg}»`);
    if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`после ${arg} нужно значение`);
    options[arg.slice(2)] = argv[i + 1];
    i += 1;
  }
  if (!options['project-dir'] || !options.report) throw new Error('нужны --project-dir и --report');
  return options;
}

async function main(argv = process.argv.slice(2), { log = console.log, error = console.error } = {}) {
  let options;
  try { options = parseArgs(argv); } catch (e) { error(`❌ ${e.message}\n${USAGE}`); return 2; }
  const projectDir = path.resolve(options['project-dir']);
  let report;
  try { report = JSON.parse(fs.readFileSync(path.resolve(options.report), 'utf8')); } catch (e) {
    error(`❌ отчёт критика не прочитан: ${e instanceof SyntaxError ? `неверный JSON (${e.message})` : 'файл не найден или недоступен'}`);
    return 2;
  }
  let manifest;
  try { manifest = readProjectManifest(projectDir); } catch (e) { error(`❌ ${e.message}`); return 2; }
  const current = manifest.currentPreview;
  if (!current) { error('❌ у проекта нет текущего preview: сначала соберите preview'); return 2; }
  if (isObject(report) && report.previewSha256 !== current.sha256) {
    error('❌ отчёт к другому preview: previewSha256 не совпадает с текущим preview проекта. Preview перерендерен, пусть критик посмотрит новые кадры.');
    return 2;
  }
  const check = validateCriticReport(report);
  if (!check.ok) {
    error(`❌ отчёт критика не принят:\n${check.errors.map((m) => `- ${m}`).join('\n')}`);
    return 2;
  }
  try {
    const { chain: previous, next } = savedChain(projectDir, error);
    const round = previous.length + 1;
    if (report.round !== round) error(`⚠️ в отчёте указан круг ${report.round}, а по сохранённым отчётам это круг ${round}: используем ${round}`);
    // Сохраняем вычисленный номер круга (он может быть и выше третьего: решение тогда «остановиться»).
    const saved = { ...report, round };
    const decision = criticDecision([...previous, saved]);
    const name = `critic-${String(next).padStart(2, '0')}`;
    const paths = writeReport(projectDir, name, { report: saved, decision }, undefined, formatCriticReport);
    log(fs.readFileSync(paths.textPath, 'utf8').trimEnd());
    log(`отчёт: qa/${name}.txt`);
    return 0;
  } catch (e) {
    error(`❌ отчёт критика не сохранён: ${e.message}`);
    return 2;
  }
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; });
}

module.exports = { AXES, criticDecision, formatCriticReport, main, overallScore, sceneScore, validateCriticReport, worstScenes };
