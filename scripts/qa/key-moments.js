// Ключевые моменты preview: секунды, по которым лист кадров показывает критику самое важное –
// появление элементов («событие», начало + 0,3 с, когда анимация входа уже читается) и середину
// показа текста («удержание»). Чистый модуль без ffmpeg: источник – манифест motion-kit, иначе
// сцены ТЗ, иначе 16 равномерных кадров.
const { sheetTimes } = require('../layer/sheet');

const EVENT_DELAY_SEC = 0.3;
const MERGE_GAP_SEC = 0.15;
const MAX_MOMENTS = 48;
const EVEN_COUNT = 16;
const LABEL_TEXT_MAX = 40;

const r3 = (value) => Math.round(value * 1000) / 1000;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

// Приводит момент к секундам отрывка; вне [0, durationSec) возвращает null.
function place(timeSec, kind, ref, label, { fromSec, durationSec }) {
  const t = r3(timeSec - fromSec);
  if (t < 0 || (finite(durationSec) && t >= durationSec)) return null;
  return { timeSec: t, kind, ref, label };
}

function momentsFromManifest(manifest, { fromSec = 0, durationSec } = {}) {
  if (!manifest || !finite(manifest.fps) || manifest.fps <= 0) return [];
  const { fps } = manifest;
  const range = { fromSec, durationSec };
  const out = [];
  const add = (moment) => { if (moment) out.push(moment); };
  for (const item of Array.isArray(manifest.texts) ? manifest.texts : []) {
    if (!item || !finite(item.from)) continue;
    const until = finite(item.until) ? item.until : (Array.isArray(item.frames) ? item.from + item.frames.length : null);
    add(place(item.from / fps + EVENT_DELAY_SEC, 'event', item.id, `${item.id}: появление`, range));
    if (until !== null && until > item.from) add(place(((item.from + until) / 2) / fps, 'hold', item.id, `${item.id}: удержание`, range));
  }
  for (const insert of Array.isArray(manifest.inserts) ? manifest.inserts : []) {
    if (!insert || !finite(insert.from)) continue;
    add(place(insert.from / fps + EVENT_DELAY_SEC, 'event', insert.id, `${insert.id}: вставка`, range));
  }
  const kept = manifest.cues && Array.isArray(manifest.cues.kept) ? manifest.cues.kept : [];
  for (const cue of kept) {
    if (!cue || cue.notable !== true || !finite(cue.hitFrame)) continue;
    add(place(cue.hitFrame / fps, 'event', cue.id, `${cue.id}: акцент`, range));
  }
  return out;
}

// Текст сцены ТЗ для подписи: у разных сцен он лежит в разных полях.
function sceneText(scene) {
  const parts = [scene.caption, scene.title, scene.text, scene.big, scene.statCream, scene.statOrange,
    scene.quoteCream, scene.quoteOrange, scene.headCream, scene.headOrange];
  return parts.filter((part) => typeof part === 'string' && part.trim()).join(' ').trim().slice(0, LABEL_TEXT_MAX);
}

function momentsFromBrief(brief, { durationSec } = {}) {
  const scenes = brief && Array.isArray(brief.scenes) ? brief.scenes : [];
  const range = { fromSec: 0, durationSec };
  const out = [];
  scenes.forEach((scene, index) => {
    if (!scene || !finite(scene.start) || !finite(scene.end) || scene.end <= scene.start) return;
    const ref = `scenes[${index}]`;
    const label = `${scene.scene} ${sceneText(scene)}`.trim();
    const event = place(scene.start + EVENT_DELAY_SEC, 'event', ref, label, range);
    const hold = place((scene.start + scene.end) / 2, 'hold', ref, label, range);
    if (event) out.push(event);
    if (hold) out.push(hold);
  });
  return out;
}

// Сортировка и слияние близких моментов: при слиянии остаётся событие.
function mergeClose(moments) {
  const rank = (m) => (m.kind === 'event' ? 0 : 1);
  const sorted = [...moments].sort((a, b) => a.timeSec - b.timeSec || rank(a) - rank(b));
  const merged = [];
  for (const moment of sorted) {
    const last = merged[merged.length - 1];
    if (last && moment.timeSec - last.timeSec < MERGE_GAP_SEC - 1e-9) {
      if (moment.kind === 'event' && last.kind !== 'event') merged[merged.length - 1] = moment;
      continue;
    }
    merged.push(moment);
  }
  return merged;
}

// Равномерное прореживание: первый и последний остаются.
function thin(list, max) {
  if (list.length <= max) return list;
  if (max <= 1) return list.slice(0, Math.max(0, max));
  const picked = new Set(Array.from({ length: max }, (_, k) => Math.round((k * (list.length - 1)) / (max - 1))));
  return list.filter((_, i) => picked.has(i));
}

function keyMoments({ manifest = null, brief = null, fromSec = 0, durationSec, max = MAX_MOMENTS } = {}) {
  let moments = momentsFromManifest(manifest, { fromSec, durationSec });
  if (!moments.length) moments = momentsFromBrief(brief, { durationSec });
  if (!moments.length) {
    moments = finite(durationSec) && durationSec > 0
      ? sheetTimes(durationSec, EVEN_COUNT).map((timeSec, i) => ({ timeSec, kind: 'even', ref: `even-${i + 1}`, label: `кадр ${i + 1} из ${EVEN_COUNT}` }))
      : [];
  }
  return thin(mergeClose(moments), max);
}

module.exports = { keyMoments, momentsFromBrief, momentsFromManifest };
