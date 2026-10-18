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

test('переход в сцену после паузы допустим: предыдущая сцена тянется через паузу', () => {
  for (const type of ['fade', 'slide', 'wipe', 'push']) {
    const result = validateMotionBrief(twoScenes({ type }, { first: [0, 3], second: [3.5, 6] }));
    assert.equal(result.ok, true, `${type}: ${result.errors.join('; ')}`);
  }
  // Длина предыдущей сцены считается по самой сцене, без паузы.
  const short = validateMotionBrief(twoScenes({ type: 'fade' }, { first: [0, 0.3], second: [2, 5] }));
  assert.equal(short.ok, false);
  assert.ok(short.errors.some((error) => error.startsWith('scenes[1].transition') && /предыдущ/.test(error)), short.errors.join('; '));
});

test('короткая сцена: вход fade и выход push не должны накладываться (три сцены в кадре)', () => {
  const at25 = (secondEnd) => brief({ output: { ...brief().output, fps: 25, durationInFrames: 150 },
    scenes: [card(0, 3), card(3, secondEnd, { transition: { type: 'fade', frames: 10 } }),
      card(secondEnd, 6, { transition: { type: 'push', frames: 10 } })] });
  // B 3–3,4 с = 10 кадров: fade в B идёт на кадрах 75–84, push в C начинается с кадра 80.
  const overlap = validateMotionBrief(at25(3.4));
  assert.equal(overlap.ok, false);
  const error = overlap.errors.find((item) => item.startsWith('scenes[2].transition'));
  assert.ok(error, overlap.errors.join('; '));
  assert.match(error, /scenes\[1\]/);
  assert.match(error, /удлините|укоротите/);
  // Та же схема, но B 3–3,6 с = 15 кадров: fade кончается на кадре 85, push начинается с 85.
  const fits = validateMotionBrief(at25(3.6));
  assert.equal(fits.ok, true, fits.errors.join('; '));
});

test('пауза 0–3 / 4–7 с fade при 30 fps: первая сцена до 4 с плюс переход, вторая ровно в 4 с', () => {
  const { planSceneTransitions } = loadMotion('src/motion/transitions.js');
  const value = twoScenes({ type: 'fade' }, { first: [0, 3], second: [4, 7] });
  const plan = planSceneTransitions(value.scenes, 30);
  assert.equal(plan[0].from, 0);
  assert.equal(plan[0].durationInFrames, 132);
  assert.equal(plan[1].from, 120);
  assert.equal(plan[1].durationInFrames, 90);
  const { MotionDirector } = loadMotion('src/MotionDirector.jsx');
  const all = children(MotionDirector(buildMotionProps({ brief: value })));
  const sequences = all.filter((el) => typeof el.props?.name === 'string' && el.props.name.startsWith('motion-scene-'));
  assert.deepEqual(sequences.map((el) => [el.props.durationInFrames, el.props.offset]), [[132, 0], [90, 0]]);
});

test('push 0–3 / 3–6 при 25 fps, frames 10: середина перехода приходится на кадр start второй сцены', () => {
  const { planSceneTransitions, transitionLead } = loadMotion('src/motion/transitions.js');
  const value = twoScenes({ type: 'push', frames: 10 });
  const plan = planSceneTransitions(value.scenes, 25);
  assert.equal(transitionLead(plan[1].transition), 5);
  assert.equal(transitionLead({ type: 'push', frames: 9 }), 4);
  assert.equal(transitionLead({ type: 'fade', frames: 10 }), 0);
  assert.equal(transitionLead(null), 0);
  // Первая удлиняется на tail = 5, вторая стартует на lead = 5 раньше, перекрытие = 10.
  assert.deepEqual(plan.map(({ from, durationInFrames }) => [from, durationInFrames]), [[0, 80], [70, 80]]);
  assert.equal(plan[0].from + plan[0].durationInFrames - plan[1].from, 10);
  assert.equal(plan[1].from + plan[1].transition.frames / 2, 75);
  // Push через паузу: первая тянется до start второй минус lead, плюс перекрытие.
  const paused = planSceneTransitions(twoScenes({ type: 'push', frames: 10 }, { first: [0, 3], second: [4, 7] }).scenes, 25);
  assert.deepEqual(paused.map(({ from, durationInFrames }) => [from, durationInFrames]), [[0, 105], [95, 80]]);
});

test('MotionDirector с push: содержимое второй сцены длится lead + номинал, первая держит хвост стоп-кадром', () => {
  const { MotionDirector } = loadMotion('src/MotionDirector.jsx', {
    useVideoConfig: () => ({ width: 1080, height: 1920, fps: 25, durationInFrames: 150 }),
  });
  const value = brief({ output: { ...brief().output, fps: 25, durationInFrames: 150 },
    scenes: [card(0, 3), card(3, 6, { transition: { type: 'push', frames: 10 } })] });
  assert.equal(validateMotionBrief(value).ok, true, validateMotionBrief(value).errors.join('; '));
  const all = children(MotionDirector(buildMotionProps({ brief: value })));
  const sequences = all.filter((el) => typeof el.props?.name === 'string' && el.props.name.startsWith('motion-scene-'));
  assert.deepEqual(sequences.map((el) => [el.props.durationInFrames, el.props.offset]), [[80, 0], [80, 0]]);
  const [first, second] = sequences.map((seq) => seq.props.children);
  // Хвост после номинального конца – стоп-кадр последнего номинального кадра.
  assert.equal(first.props.frame, 74);
  assert.equal(first.props.active(74), false);
  assert.equal(first.props.active(75), true);
  assert.equal(first.props.children.props.durationInFrames, 75);
  assert.equal(second.props.frame, 79);
  assert.equal(second.props.children.props.durationInFrames, 80);
  assert.equal(second.props.children.props.leadFrames, 5);
});

test('стоп-кадр хвоста: живая часть = lead + номинал, дальше держится её последний кадр', () => {
  const { sceneHold } = loadMotion('src/motion/transitions.js');
  assert.deepEqual(sceneHold({ lead: 0, nominal: 90 }), { liveFrames: 90, freezeFrame: 89 });
  assert.deepEqual(sceneHold({ lead: 5, nominal: 75 }), { liveFrames: 80, freezeFrame: 79 });
  const { contentFrameAt } = loadMotion('src/motion/transitions.js');
  assert.equal(contentFrameAt(10, 90), 10);
  assert.equal(contentFrameAt(89, 90), 89);
  assert.equal(contentFrameAt(95, 90), 89);
  assert.equal(contentFrameAt(131, 90), 89);
});

test('push с видео во второй сцене: кадр клипа в момент start прежний, до start держится первый кадр', () => {
  const { mediaClipFrame } = loadMotion('src/motion/MediaScene.jsx');
  const trimBefore = 50;
  // Без перехода в start (локальный кадр 0) клип показывает trimBefore.
  assert.deepEqual(mediaClipFrame({ localFrame: 0, lead: 0, trimBefore }), { clipFrame: 50, hold: false });
  // С push lead = 5: в start локальный кадр 5, клип тот же; раньше – стоп-кадр первого кадра.
  assert.deepEqual(mediaClipFrame({ localFrame: 5, lead: 5, trimBefore }), { clipFrame: 50, hold: false });
  assert.deepEqual(mediaClipFrame({ localFrame: 2, lead: 5, trimBefore }), { clipFrame: 50, hold: true });
  assert.deepEqual(mediaClipFrame({ localFrame: 30, lead: 5, trimBefore }), { clipFrame: 75, hold: false });
  const { MediaScene } = loadMotion('src/motion/MediaScene.jsx', { useCurrentFrame: () => 2 });
  const media = { kind: 'video', src: 'assets/clip.mp4', sha256: 'a'.repeat(64), fit: 'cover', trimStartSec: 2, audioMode: 'replace' };
  const holding = children(MediaScene({ media, durationInFrames: 80, leadFrames: 5 }));
  const freeze = holding.find((el) => el.props?.frame === 0 && el.props?.children?.type === 'video');
  assert.ok(freeze, 'до start видео – стоп-кадр первого кадра клипа');
  assert.equal(freeze.props.children.props.trimBefore, 60);
  const { MediaScene: Playing } = loadMotion('src/motion/MediaScene.jsx', { useCurrentFrame: () => 30 });
  const playing = children(Playing({ media, durationInFrames: 80, leadFrames: 5 }));
  const delayed = playing.find((el) => el.type === 'sequence');
  assert.equal(delayed.props.from, 5, 'видео стартует на lead кадров позже начала содержимого');
  const video = playing.find((el) => el.type === 'video');
  assert.equal(video.props.trimBefore, 60);
  // Огибающая звука клипа считается по номинальной длине сцены, как без перехода.
  const { brollClipVolume } = loadMotion('src/scenes/BrollMedia.jsx');
  for (const localFrame of [0, 10, 70, 74]) {
    assert.equal(video.props.volume(localFrame),
      brollClipVolume({ mode: 'replace', localFrame, durationInFrames: 75, fps: 30 }), `кадр ${localFrame}`);
  }
  // Без перехода разметка видео прежняя: ни Sequence, ни Freeze.
  const plain = children(Playing({ media, durationInFrames: 75 }));
  assert.equal(plain.some((el) => el.type === 'sequence'), false);
  assert.equal(plain.find((el) => el.type === 'video').props.trimBefore, 60);
});

test('лишние поля перехода: ошибка прямо говорит, что убрать', () => {
  const cases = [
    [{ type: 'fade', direction: 'left' }, /уберите direction/],
    [{ type: 'push', direction: 'up' }, /уберите direction/],
    [{ type: 'cut', frames: 10 }, /уберите frames/],
    [{ type: 'cut', direction: 'left' }, /уберите direction/],
  ];
  for (const [transition, pattern] of cases) {
    const result = validateMotionBrief(twoScenes(transition));
    assert.equal(result.ok, false, JSON.stringify(transition));
    assert.ok(result.errors.some((error) => error.startsWith('scenes[1].transition') && pattern.test(error)), result.errors.join('; '));
  }
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
  assert.match(rows[4], /Вход: push, 0,23 с, середина на границе/);
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

test('склейка push приходится ровно на кадр lead: новая сцена не видна раньше своего start', () => {
  const { presentationFor, resolveTransition, transitionLead } = loadMotion('src/motion/transitions.js');
  const size = { width: 1080, height: 1920 };
  for (const fps of [25, 30, 50]) {
    for (const frames25 of [6, 10, 15]) {
      const transition = resolveTransition({ type: 'push', frames: frames25 }, fps);
      const lead = transitionLead(transition);
      const { presentation, timing } = presentationFor(transition, size);
      // pushCut показывает входящую сцену с прогресса cutProgress (по умолчанию 5/11).
      const cut = presentation.props.cutProgress ?? 5 / 11;
      const at = (frame) => timing.getProgress({ frame, fps });
      const label = `${fps} fps, frames ${frames25} (${transition.frames} кадров), lead ${lead}`;
      assert.ok(at(lead - 1) < cut, `${label}: склейка раньше lead, прогресс ${at(lead - 1)} >= ${cut}`);
      assert.ok(cut <= at(lead), `${label}: склейка позже lead, прогресс ${at(lead)} < ${cut}`);
    }
  }
});

test('проверки push «раньше предыдущей сцены» и «раньше начала ролика» срабатывают только у пересекающихся сцен', () => {
  // Сцены по порядку: own.from >= before.to, длина перехода <= длины предыдущей >= lead, start >= 0,
  // поэтому push не может начаться раньше предыдущей сцены или ролика.
  const ordered = validateMotionBrief(twoScenes({ type: 'push', frames: 15 }, { first: [0, 0.6], second: [0.6, 3] }));
  assert.ok(ordered.ok, ordered.errors.join('\n'));
  // Пересечение (уже ошибка) – единственный путь к этим сообщениям.
  const overlap = validateMotionBrief(twoScenes({ type: 'push', frames: 10 }, { first: [0, 3], second: [0.12, 3.5] }));
  const text = overlap.errors.join('\n');
  assert.match(text, /пересекается с предыдущей сценой/);
  assert.match(text, /раньше начала предыдущей сцены/);
  assert.match(text, /раньше начала ролика/);
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
  // Содержимое – прежняя длительность из ТЗ внутри стоп-кадра хвоста.
  sequences.forEach((seq) => {
    assert.equal(seq.props.children.props.frame, 89);
    assert.equal(seq.props.children.props.children.props.durationInFrames, 90);
  });
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

test('реальный кадр: хвост видео-сцены через паузу и в середине fade – стоп-кадр последнего кадра клипа', {
  skip: process.env.AUTOMONTAGE_TEST_MOTION_RENDER !== '1', timeout: 240_000,
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
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-transition-hold-'));
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const publicDir = path.join(work, 'public');
  fs.mkdirSync(path.join(publicDir, 'assets'), { recursive: true });
  const ffmpeg = process.env.AUTOMONTAGE_FFMPEG_DIR
    ? path.join(process.env.AUTOMONTAGE_FFMPEG_DIR, 'ffmpeg') : 'ffmpeg';
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', path.join(publicDir, 'narration.wav')]);
  // Клип ровно на длину сцены (2 с): после её конца видео продолжать нечем.
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30:duration=2',
    '-pix_fmt', 'yuv420p', path.join(publicDir, 'assets/clip.mp4')]);
  const serveUrl = await bundle({ entryPoint: path.join(root, 'src/index.js'), publicDir, outDir: path.join(work, 'bundle') });
  const browser = await openBrowser('chrome', { logLevel: 'error' });
  t.after(() => browser.close({ silent: true }));
  // Видео 0–2 с, пауза до 2,5 с, затем fade (12 кадров при 30 fps): хвост клипа – кадры 60–86.
  const value = brief({ output: { ...brief().output, durationInFrames: 180 }, scenes: [
    { scene: 'media', start: 0, end: 2,
      media: { kind: 'video', src: 'assets/clip.mp4', sha256: 'a'.repeat(64), fit: 'cover', frame: 'full' } },
    { scene: 'card', title: 'Вторая сцена', start: 2.5, end: 5.5, transition: { type: 'fade' } },
  ] });
  assert.equal(validateMotionBrief(value).ok, true, validateMotionBrief(value).errors.join('; '));
  const inputProps = buildMotionProps({ brief: value, sourceFile: 'narration.wav' });
  const composition = await selectComposition({ serveUrl, id: 'MotionReel', inputProps, puppeteerInstance: browser });
  const still = async (frame) => {
    const output = path.join(work, `frame-${frame}.png`);
    await renderStill({ serveUrl, composition: { ...composition, props: inputProps }, inputProps,
      puppeteerInstance: browser, frame, imageFormat: 'png', output, logLevel: 'error' });
    return output;
  };
  const last = await still(59);
  const paused = await still(70);
  assert.ok(fs.readFileSync(paused).equals(fs.readFileSync(last)), 'в паузе держится последний кадр клипа');
  const middle = await still(81);
  const share = frameEdgeShare(middle, null);
  assert.ok(Number.isFinite(share) && share > SHARE_THRESHOLD, `G12 edgeShare ${share}`);
});
