import { useCurrentFrame, useVideoConfig } from 'remotion';
import { Odometer, formatNumber } from '../details/index.js';
import { SceneFrame, TextBox } from './parts';
import { clamp01, motionTheme as t } from './motion-theme';

// Прокрутка 1,5 с + оседание 0,5 с; в короткой сцене обе части сжимаются, но к последнему кадру число стоит.
const rollTiming = (fps, durationInFrames) => {
  const total = Math.max(0, Math.min(2, (durationInFrames - 1) / fps));
  return { total, rollSec: total * 0.75, settleSec: total * 0.25 };
};

export const CounterScene = ({ label, value, prefix = '', suffix = '', layout = 'inline', caption, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { total, rollSec, settleSec } = rollTiming(fps, durationInFrames);
  const progress = total <= 0 ? 1 : clamp01(frame / (total * fps));
  const stack = layout === 'stack';
  return <SceneFrame caption={caption}>
    <TextBox text={label} height={260} maxSize={76} weight={600} />
    <TextBox data-counter-value={formatNumber(value)} height={stack ? 560 : 390} maxSize={190} weight={800}
      style={{ color: t.accent, whiteSpace: 'nowrap', overflowWrap: 'normal' }}>
      <Odometer value={value} prefix={prefix} suffix={suffix} layout={layout} data-motion-text={null}
        affixColor={t.muted} rollSec={rollSec} settleSec={settleSec} />
    </TextBox>
    <div aria-hidden="true" style={{ height: 14, background: t.line, borderRadius: 7 }}>
      <div style={{ width: `${progress * 100}%`, height: '100%', background: t.accent, borderRadius: 7 }} />
    </div>
  </SceneFrame>;
};
