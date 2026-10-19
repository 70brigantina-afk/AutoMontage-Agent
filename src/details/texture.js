// Математика текстуры кадра: сдвиг зерна, дрейф фона, проход блика. Без React и тем.
export const GRAIN_OPACITY = 0.06;
export const GRAIN_TILE = 256;
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

export const grainOffset = (frame, { stepFrames = 2, seed = 7 } = {}) => {
  const step = Math.floor(Math.max(0, frame) / stepFrames);
  return { x: hash(step, seed) % GRAIN_TILE, y: hash(step, seed + 101) % GRAIN_TILE };
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
