import { createContext, useContext } from 'react';
import { staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { motionTheme } from '../motion/motion-theme';
import { GRAIN_OPACITY, GRAIN_TILE, driftAt, grainOffset, sheenProgress } from './texture.js';

// 'none' | 'subtle': Panel узнаёт режим отсюда и рисует блик только при subtle.
export const TextureContext = createContext('none');
export const useTexture = () => useContext(TextureContext);

const fill = { position: 'absolute', inset: 0, pointerEvents: 'none' };

// Зерно лежит под сценой: плитка сдвигается раз в 2 кадра на детерминированный шаг.
export const Grain = ({ opacity = GRAIN_OPACITY, src = 'textures/grain-256.png' }) => {
  const frame = useCurrentFrame();
  const { x, y } = grainOffset(frame);
  return <div aria-hidden="true" data-texture-grain="true" style={{ ...fill,
    backgroundImage: `url(${staticFile(src)})`, backgroundSize: `${GRAIN_TILE}px ${GRAIN_TILE}px`,
    backgroundPosition: `${-x}px ${-y}px`, opacity: Math.min(opacity, GRAIN_OPACITY),
  }} />;
};

// Медленный дрейф цветных пятен фона. Слой шире кадра на амплитуду, края не открываются.
export const Drift = ({ colors = [motionTheme.accentSoft, motionTheme.line], amplitude = 0.06 }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const { x, y } = driftAt(frame, fps, { amplitude });
  const [first, second] = colors;
  return <div aria-hidden="true" data-texture-drift="true" style={{ ...fill, overflow: 'hidden' }}>
    <div style={{ position: 'absolute', inset: `${-amplitude * 100}%`,
      transform: `translate(${x * width}px, ${y * height}px)`,
      background: `radial-gradient(circle at 25% 20%, ${first} 0%, transparent 55%), radial-gradient(circle at 80% 85%, ${second} 0%, transparent 50%)`,
      opacity: 0.55,
    }} />
  </div>;
};

// Один проход по карточке на входе; вне прохода ничего не рисуется (не в цикле).
export const Sheen = ({ enterFrame = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = sheenProgress(frame, fps, enterFrame);
  if (progress === null) return null;
  return <div aria-hidden="true" data-texture-sheen="true" style={{ ...fill, overflow: 'hidden', borderRadius: 'inherit' }}>
    <div style={{ position: 'absolute', top: 0, bottom: 0, width: '40%', left: `${-40 + 140 * progress}%`,
      background: `linear-gradient(100deg, transparent 0%, ${motionTheme.panel} 50%, transparent 100%)`,
      opacity: 0.35, transform: 'skewX(-12deg)',
    }} />
  </div>;
};
