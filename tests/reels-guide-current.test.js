const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Курс «Ролики с нуля» должен описывать движок 1.24: финал сразу после «Утверждаю»,
// стартовая карточка «Что делаем?» и шаг обновления движка.

const ROOT = path.resolve(__dirname, '..');
const GUIDE = 'docs/reels-guide';
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
// Текст без переносов строк: фразы в Markdown переносятся где угодно.
const flat = relativePath => read(relativePath).replace(/\s+/gu, ' ');
const EM_DASH = String.fromCodePoint(0x2014);

// Старые формулировки: «передайте фразу – агент соберёт финал» для обычного полного preview.
const STALE_FINAL = [
  /Скопируйте фразу для агента ?[-–] ?он соберёт финал/u,
  /фраз\S*.{0,100}?(?:агент|он) (?:соберёт|собирает) финал/iu,
  /Финалы? он собирает/u,
  /Фраза из пульта ?[-–] ?это команда «собирай»/u,
  /Фразу из пульта не передали агенту/u,
  /Только после неё агент собирает финал/u,
  /Передаём утверждение агенту/u,
];

test('после «Утверждаю» финал не ждёт фразы агенту в уроках 05, 06, 08, 10 и шпаргалке', () => {
  for (const name of ['05-pult.md', '06-final.md', '08-batch.md', '10-ai-promo.md', 'PROMPTS.md', 'README.md']) {
    const text = flat(`${GUIDE}/${name}`);
    for (const pattern of STALE_FINAL) assert.doesNotMatch(text, pattern, `${name}: ${pattern}`);
  }
});

test('нет устаревшей цифры «семь финалов за 22 минуты»', () => {
  for (const name of fs.readdirSync(path.join(ROOT, GUIDE)).filter(f => f.endsWith('.md'))) {
    const text = flat(`${GUIDE}/${name}`);
    assert.doesNotMatch(text, /семь финалов/u, name);
    assert.doesNotMatch(text, /за 22 минуты/u, name);
  }
});

test('урок 05: «Утверждаю» сразу даёт финал, проверка финала в фоне, рендер только для исключений', () => {
  const text = flat(`${GUIDE}/05-pult.md`);
  assert.match(text, /Финал готов ?[-–] ?можно забирать/u);
  assert.match(text, /за секунды/u);
  assert.match(text, /в фоне/u);
  assert.match(text, /фрагмент/iu);
  assert.match(text, /4K/u);
});

test('урок 04 и README курса начинаются с карточки «Что делаем?»', () => {
  const montage = flat(`${GUIDE}/04-montage.md`);
  assert.match(montage, /«Что делаем\?»/u);
  for (const question of ['Формат?', 'Из чего собираем?', 'Как монтируем?']) {
    assert.ok(montage.includes(`«${question}»`), question);
  }
  // «По референсу» – ответ про исходник и только для вертикали.
  assert.match(montage, /референс[^.]*9:16|9:16[^.]*референс/iu);
  assert.match(flat(`${GUIDE}/README.md`), /«Что делаем\?»/u);
  assert.match(flat(`${GUIDE}/README.md`), /финал за секунды/iu);
});

test('урок 01: раздел обновления движка с npm ci и фразой агенту', () => {
  const text = read(`${GUIDE}/01-setup.md`);
  const start = text.search(/^## .*Обновление движка/mu);
  assert.ok(start >= 0, 'нет раздела «Обновление движка»');
  const rest = text.slice(start + 3);
  const next = rest.search(/\n## /u);
  const section = next < 0 ? rest : rest.slice(0, next);
  assert.match(section, /npm ci/u);
  assert.match(section, /git pull/u);
  assert.match(section, /requirements\.txt/u);
  assert.match(section, /Обнови движок/u);
  assert.match(flat(`${GUIDE}/PROMPTS.md`), /Обнови движок/u);
});

test('словарь: маршрут через «Что делаем?», актуальные проверки, финал из preview', () => {
  const text = flat(`${GUIDE}/GLOSSARY.md`);
  assert.doesNotMatch(text, /Основных ?[-–] ?12/u);
  assert.match(text, /G16/u);
  assert.match(text, /«Что делаем\?»/u);
  assert.doesNotMatch(text, /Creative Motion, готовый стиль или по референсу/u);
});

test('docs/BATCH-REELS-WORKFLOW.md: финалы из просмотренного preview не рендерятся заново', () => {
  const text = flat('docs/BATCH-REELS-WORKFLOW.md');
  assert.doesNotMatch(text, /approved-финалы рендерятся последовательно/u);
  assert.match(text, /D-051/u);
});

test('во всех файлах курса нет длинного тире и личных путей', () => {
  for (const name of fs.readdirSync(path.join(ROOT, GUIDE)).filter(f => f.endsWith('.md'))) {
    const text = read(`${GUIDE}/${name}`);
    assert.ok(!text.includes(EM_DASH), `${name}: U+2014`);
    assert.doesNotMatch(text, /\/Users\/|\/home\//u, name);
  }
});
