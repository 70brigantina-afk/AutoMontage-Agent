// Математика текстуры кадра: сдвиг зерна, дрейф фона, проход блика. Без React и тем.
export const GRAIN_OPACITY = 0.06;
export const GRAIN_TILE = 256;
// Непрозрачность слоя дрейфа: от неё зависит худший контраст подписи над пятном.
export const DRIFT_OPACITY = 0.3;
// Ключи motionTheme для двух пятен дрейфа: оба не темнее accentSoft, чтобы подпись держала контраст 4.5.
export const DRIFT_COLOR_KEYS = Object.freeze(['accentSoft', 'panel']);
const SHEEN_FRAMES_25 = 12;

// Детерминированный хеш (целое от шага и seed): один и тот же кадр всегда даёт один сдвиг.
const hash = (a, b) => {
  let h = Math.imul(a ^ 0x9E3779B9, 0x85EBCA6B) ^ Math.imul(b + 0x7F4A7C15, 0xC2B2AE35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2C1B3C6D);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297A2D39);
  h ^= h >>> 15;
  return h >>> 0;
};

// Зерно неподвижно: сдвиг зависит только от seed. Меняющееся раз в 2 кадра зерно – полнокадровый
// шум, h264 его не сжимает (27 с ролика весили 78–136 МБ вместо ~1 МБ). animated: true – явный
// старый режим (шаг раз в stepFrames кадров); маршруты сборки его не используют.
export const grainOffset = (frame, { stepFrames = 2, seed = 7, animated = false } = {}) => {
  const step = animated ? Math.floor(Math.max(0, frame) / stepFrames) : 0;
  return { x: hash(step, seed) % GRAIN_TILE, y: hash(step, seed + 101) % GRAIN_TILE };
};

// Порог относительной яркости (WCAG): ниже – фон тёмный и зерно на нём заметно.
export const DARK_LUMINANCE = 0.4;

const parseColor = (color) => {
  if (typeof color !== 'string') return null;
  const value = color.trim();
  let match = /^#([0-9a-f]{3})$/i.exec(value);
  if (match) return [...match[1]].map((c) => parseInt(c + c, 16));
  match = /^#([0-9a-f]{6})$/i.exec(value);
  if (match) return [0, 2, 4].map((i) => parseInt(match[1].slice(i, i + 2), 16));
  match = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/i.exec(value);
  if (match) return match.slice(1, 4).map(Number).map((c) => Math.min(255, c));
  return null;
};

// true – фон тёмный (относительная яркость < 0.4). Нераспознанный цвет считается светлым: зерно не рисуем.
export const isDarkBackground = (color) => {
  const rgb = parseColor(color);
  if (!rgb) return false;
  const [r, g, b] = rgb.map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < DARK_LUMINANCE;
};

// Доли размера кадра; период замкнут, поэтому кадр 0 и кадр через periodSec совпадают.
export const driftAt = (frame, fps, { periodSec = 8, amplitude = 0.06 } = {}) => {
  const phase = (2 * Math.PI * frame) / (fps * periodSec);
  return { x: amplitude * Math.sin(phase), y: amplitude * Math.cos(phase) };
};

// 0..1 внутри одного прохода, null вне него (до входа и после 12 кадров при 25 fps).
export const sheenProgress = (frame, fps, enterFrame = 0, { frames25 = SHEEN_FRAMES_25 } = {}) => {
  const frames = Math.max(1, Math.round((frames25 * fps) / 25));
  const local = frame - enterFrame;
  if (local < 0 || local >= frames) return null;
  return local / frames;
};
