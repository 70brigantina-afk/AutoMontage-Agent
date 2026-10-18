const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { loadMotion, brief } = require('./helpers/motion-render');
const { buildMotionProps, validateMotionBrief } = require('../scripts/motion/brief');

function children(element) {
  if (!element || typeof element !== 'object') return [];
  return [element, ...React.Children.toArray(element.props?.children).flatMap(children)];
}

const card = (start, end, extra = {}) => ({ scene: 'card', title: `Сцена ${start}`, start, end, ...extra });

function twoScenes(transition, { first = [0, 3], second = [3, 6] } = {}) {
  return brief({ scenes: [card(...first), card(...second, transition ? { transition } : {})] });
}

test('без transition план сцен совпадает с прежними границами Sequence', () => {
  const { planSceneTransitions } = loadMotion('src/motion/transitions.js');
  const { getMotionTiming } = loadMotion('src/MotionDirector.jsx');
  const { scenes } = brief();
  const plan = planSceneTransitions(scenes, 30);
  assert.equal(plan.length, scenes.length);
  plan.forEach((item, index) => {
    assert.deepEqual(item, { index, ...getMotionTiming(scenes[index], 30), transition: null });
  });
  const explicitCut = planSceneTransitions(scenes.map((scene) => ({ ...scene, transition: { type: 'cut' } })), 30);
  assert.deepEqual(explicitCut, plan);
});

test('fade по умолчанию при 30 fps удлиняет предыдущую сцену на 12 кадров, начало второй не сдвигается', () => {
  const { planSceneTransitions, DEFAULT_TRANSITION_FRAMES_25, TRANSITION_TYPES } = loadMotion('src/motion/transitions.js');
  assert.deepEqual(TRANSITION_TYPES, ['cut', 'fade', 'slide', 'wipe', 'push']);
  assert.equal(DEFAULT_TRANSITION_FRAMES_25, 10);
  // CommonJS-валидатор ТЗ держит копию тех же значений.
  const briefModule = require('../scripts/motion/brief');
  assert.deepEqual(briefModule.MOTION_TRANSITION_TYPES, TRANSITION_TYPES);
  assert.deepEqual(briefModule.TRANSITION_FRAMES_25, { default: DEFAULT_TRANSITION_FRAMES_25, min: 6, max: 15 });
  const plan = planSceneTransitions(twoScenes({ type: 'fade' }).scenes, 30);
  assert.deepEqual(plan, [
    { index: 0, from: 0, durationInFrames: 102, transition: null },
    { index: 1, from: 90, durationInFrames: 90, transition: { type: 'fade', frames: 12, direction: null } },
  ]);
  // Видимый таймлайн: сумма длительностей минус перекрытия равна прежней длительности.
  const visible = plan.reduce((sum, item) => sum + item.durationInFrames - (item.transition?.frames ?? 0), 0);
  assert.equal(visible, 180);
});

test('frames задаются в кадрах эталона 25 fps и пересчитываются через ref25, direction по умолчанию left', () => {
  const { planSceneTransitions } = loadMotion('src/motion/transitions.js');
  const plan = planSceneTransitions(twoScenes({ type: 'slide', frames: 15 }).scenes, 30);
  assert.deepEqual(plan[1].transition, { type: 'slide', frames: 18, direction: 'left' });
  assert.equal(plan[0].durationInFrames, 108);
  const at25 = planSceneTransitions(twoScenes({ type: 'wipe', frames: 6, direction: 'up' }).scenes, 25);
  assert.deepEqual(at25[1].transition, { type: 'wipe', frames: 6, direction: 'up' });
  assert.equal(at25[0].durationInFrames, 81);
});

test('валидатор принимает переходы в допустимых пределах', () => {
  for (const transition of [{ type: 'cut' }, { type: 'fade' }, { type: 'fade', frames: 6 },
    { type: 'slide', direction: 'right' }, { type: 'wipe', frames: 15, direction: 'down' }, { type: 'push' }]) {
    const result = validateMotionBrief(twoScenes(transition));
    assert.equal(result.ok, true, `${JSON.stringify(transition)}: ${result.errors.join('; ')}`);
  }
});

test('frames вне 6–15 кадров при 25 fps отклоняются', () => {
  for (const frames of [20, 5, 16]) {
    const result = validateMotionBrief(twoScenes({ type: 'fade', frames }));
    assert.equal(result.ok, false, `frames ${frames}`);
    assert.ok(result.errors.some((error) => error.includes('scenes[1].transition.frames')), result.errors.join('; '));
  }
});

test('схема ограничивает frames 6–15: это кадры эталона 25 fps, а не FPS ролика', () => {
  const schema = require('../schema/motion-brief.schema.json');
  const frames = schema.definitions.sceneTransition.properties.frames;
  assert.equal(frames.minimum, 6);
  assert.equal(frames.maximum, 15);
  assert.match(frames.description, /25 fps/);
  // При 60 fps 15 эталонных кадров – это 36 кадров ролика, и ТЗ остаётся валидным.
  const at60 = brief({ output: { ...brief().output, fps: 60, durationInFrames: 1320 },
    scenes: [card(0, 3), card(3, 6, { transition: { type: 'fade', frames: 15 } })] });
  assert.equal(validateMotionBrief(at60).ok, true, validateMotionBrief(at60).errors.join('; '));
});

test('переход у первой сцены отклоняется с ошибкой scenes[0].transition', () => {
  const value = brief({ scenes: [card(0, 3, { transition: { type: 'fade' } }), card(3, 6)] });
  const result = validateMotionBrief(value);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.startsWith('scenes[0].transition')), result.errors.join('; '));
  // Явный cut у первой сцены ничего не меняет и допустим.
  assert.equal(validateMotionBrief(brief({ scenes: [card(0, 3, { transition: { type: 'cut' } }), card(3, 6)] })).ok, true);
});

test('переход длиннее предыдущей сцены отклоняется (сцена 0,3 с, переход 0,4 с)', () => {
  const result = validateMotionBrief(twoScenes({ type: 'fade' }, { first: [0, 0.3], second: [0.3, 3] }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.startsWith('scenes[1].transition') && /предыдущ/.test(error)), result.errors.join('; '));
});

test('переход длиннее своей сцены отклоняется', () => {
  const result = validateMotionBrief(twoScenes({ type: 'fade' }, { first: [0, 3], second: [3, 3.3] }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.startsWith('scenes[1].transition')), result.errors.join('; '));
});

test('переход в сцену после паузы отклоняется: входить можно только встык', () => {
  const result = validateMotionBrief(twoScenes({ type: 'fade' }, { first: [0, 3], second: [3.5, 6] }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.startsWith('scenes[1].transition') && /встык/.test(error)), result.errors.join('; '));
});

test('неизвестный тип, лишние поля и direction у fade/push отклоняются', () => {
  for (const transition of [{ type: 'zoom' }, { type: 'dissolve' }, { type: 'fade', speed: 2 },
    { type: 'fade', direction: 'left' }, { type: 'push', direction: 'up' }, { type: 'cut', frames: 10 },
    { type: 'slide', direction: 'diagonal' }, { type: 'fade', frames: 10.5 }]) {
    const result = validateMotionBrief(twoScenes(transition));
    assert.equal(result.ok, false, JSON.stringify(transition));
    assert.ok(result.errors.some((error) => error.includes('scenes/1') || error.includes('scenes[1]')), result.errors.join('; '));
  }
});

test('Markdown-ТЗ показывает тип, длительность и направление перехода, а cut и отсутствие перехода – нет', () => {
  const { formatMotionBriefMarkdown } = require('../scripts/motion/brief');
  const value = brief({ scenes: [card(0, 3), card(3, 6, { transition: { type: 'fade' } }),
    card(6, 9, { transition: { type: 'slide', frames: 15, direction: 'up' } }),
    card(9, 12, { transition: { type: 'cut' } }), card(12, 15, { transition: { type: 'push', frames: 6 } })] });
  assert.equal(validateMotionBrief(value).ok, true);
  const rows = formatMotionBriefMarkdown(value).split('\n').filter((line) => /^\| 0\d \|/.test(line));
  assert.equal(rows.length, 5);
  assert.doesNotMatch(rows[0], /Вход/);
  assert.match(rows[1], /Вход: fade, 0,4 с/);
  assert.match(rows[2], /Вход: slide, 0,6 с, вверх/);
  assert.doesNotMatch(rows[3], /Вход/);
  assert.match(rows[4], /Вход: push, 0,23 с/);
});

test('presentationFor отдаёт презентацию и timing на frames кадров', () => {
  const { presentationFor } = loadMotion('src/motion/transitions.js');
  const size = { width: 1080, height: 1920 };
  for (const transition of [
    { type: 'fade', frames: 12, direction: null },
    { type: 'slide', frames: 12, direction: 'left' },
    { type: 'wipe', frames: 9, direction: 'down' },
    { type: 'push', frames: 18, direction: null },
  ]) {
    const { presentation, timing } = presentationFor(transition, size);
    assert.equal(typeof presentation.component, 'function', transition.type);
    assert.equal(timing.getDurationInFrames({ fps: 30 }), transition.frames, transition.type);
  }
  assert.equal(presentationFor({ type: 'slide', frames: 12, direction: 'left' }, size).presentation.props.direction, 'from-right');
  assert.equal(presentationFor({ type: 'wipe', frames: 12, direction: 'up' }, size).presentation.props.direction, 'from-bottom');
  assert.throws(() => presentationFor({ type: 'zoom', frames: 10 }, size), /zoom/);
});

test('MotionDirector без не-cut переходов рендерит прежние Sequence кадр-в-кадр', () => {
  const { MotionDirector } = loadMotion('src/MotionDirector.jsx');
  const base = brief();
  const cut = brief({ scenes: base.scenes.map((scene) => ({ ...scene, transition: { type: 'cut' } })) });
  for (const value of [base, cut]) {
    const all = children(MotionDirector(buildMotionProps({ brief: value })));
    const sequences = all.filter((el) => el.type === 'sequence');
    assert.equal(sequences.length, 7);
    sequences.forEach((seq, index) => {
      assert.equal(seq.props.from, index * 90);
      assert.equal(seq.props.durationInFrames, 90);
      assert.equal(seq.props.children.props.durationInFrames, 90);
    });
    assert.equal(all.some((el) => el.props?.timing), false, 'нет TransitionSeries.Transition');
  }
});

test('MotionDirector с fade собирает TransitionSeries, звук и содержимое сцен по прежним границам', () => {
  const { MotionDirector } = loadMotion('src/MotionDirector.jsx');
  const value = brief({ output: { ...brief().output, durationInFrames: 270 }, scenes: [
    card(0, 3), card(3, 6, { transition: { type: 'fade' } }),
    { scene: 'media', start: 6, end: 9, transition: { type: 'cut' },
      media: { kind: 'video', src: 'assets/clip.mp4', sha256: 'a'.repeat(64), fit: 'cover', audioMode: 'replace' } },
  ] });
  const all = children(MotionDirector(buildMotionProps({ brief: value })));
  assert.equal(all.filter((el) => el.type === 'sequence').length, 0);
  const sequences = all.filter((el) => typeof el.props?.name === 'string' && el.props.name.startsWith('motion-scene-'));
  assert.deepEqual(sequences.map((el) => [el.props.durationInFrames, el.props.offset]), [[102, 0], [90, 0], [90, 0]]);
  sequences.forEach((seq) => assert.equal(seq.props.children.props.durationInFrames, 90));
  const transitions = all.filter((el) => el.props?.timing && el.props?.presentation);
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].props.timing.getDurationInFrames({ fps: 30 }), 12);
  const audio = all.find((el) => el.type === 'audio');
  assert.equal(audio.props.volume(150), 1);
  assert.equal(audio.props.volume(200), 0, 'replace-сцена глушит narration по своим прежним границам');
});

test('MotionDirector в режиме переходов сохраняет паузы между сценами через offset', () => {
  const { MotionDirector } = loadMotion('src/MotionDirector.jsx');
  const value = brief({ scenes: [card(1, 3), card(3, 6, { transition: { type: 'wipe' } }), card(7, 9)] });
  assert.equal(validateMotionBrief(value).ok, true);
  const all = children(MotionDirector(buildMotionProps({ brief: value })));
  const sequences = all.filter((el) => typeof el.props?.name === 'string' && el.props.name.startsWith('motion-scene-'));
  // Сцена 0 с кадра 30, удлинена на 12; сцена 1 стартует на 102 - 12 = 90; сцена 2 – после паузы с 210.
  assert.deepEqual(sequences.map((el) => [el.props.durationInFrames, el.props.offset]), [[72, 30], [90, 0], [60, 30]]);
});

test('реальный кадр в середине fade не пустой и содержит обе сцены', {
  skip: process.env.AUTOMONTAGE_TEST_MOTION_RENDER !== '1', timeout: 180_000,
}, async (t) => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const { execFileSync } = require('node:child_process');
  const { bundle } = require('@remotion/bundler');
  const { openBrowser, renderStill, selectComposition } = require('@remotion/renderer');
  const { frameEdgeShare } = require('../scripts/layer/sheet');
  const { SHARE_THRESHOLD } = require('../scripts/qa/empty-frame-gate');
  const root = path.join(__dirname, '..');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-transition-render-'));
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const publicDir = path.join(work, 'public');
  fs.mkdirSync(publicDir, { recursive: true });
  const ffmpeg = process.env.AUTOMONTAGE_FFMPEG_DIR
    ? path.join(process.env.AUTOMONTAGE_FFMPEG_DIR, 'ffmpeg') : 'ffmpeg';
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=7', path.join(publicDir, 'narration.wav')]);
  const serveUrl = await bundle({ entryPoint: path.join(root, 'src/index.js'), publicDir, outDir: path.join(work, 'bundle') });
  const browser = await openBrowser('chrome', { logLevel: 'error' });
  t.after(() => browser.close({ silent: true }));
  const texts = [];
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...args) => {
    const page = await newPage(...args);
    const close = page.close.bind(page);
    page.close = async (...closeArgs) => {
      try {
        texts.push(await page.evaluate(() => [...document.querySelectorAll('[data-motion-text]')].map((el) => el.textContent)));
      } finally { await close(...closeArgs); }
    };
    return page;
  };
  const value = brief({ output: { ...brief().output, durationInFrames: 180 }, scenes: [
    { scene: 'card', title: 'Первая сцена', start: 0, end: 3 },
    { scene: 'card', title: 'Вторая сцена', start: 3, end: 6, transition: { type: 'fade' } },
  ] });
  const inputProps = buildMotionProps({ brief: value, sourceFile: 'narration.wav' });
  const composition = await selectComposition({ serveUrl, id: 'MotionReel', inputProps, puppeteerInstance: browser });
  assert.equal(composition.durationInFrames, 180);
  const output = path.join(work, 'fade-mid.png');
  await renderStill({ serveUrl, composition: { ...composition, props: inputProps }, inputProps,
    puppeteerInstance: browser, frame: 96, imageFormat: 'png', output, logLevel: 'error' });
  const share = frameEdgeShare(output, null);
  assert.ok(Number.isFinite(share) && share > SHARE_THRESHOLD, `G12 edgeShare ${share}`);
  const visible = (texts.at(-1) || []).join(' ');
  assert.match(visible, /Первая сцена/);
  assert.match(visible, /Вторая сцена/);
});
