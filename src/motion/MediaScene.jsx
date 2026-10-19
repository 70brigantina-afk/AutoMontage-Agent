import {
  AbsoluteFill, Freeze, Img, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig,
} from 'remotion';
import { brollClipVolume } from '../scenes/BrollMedia';
import { SceneFrame, TextBox, useEntrance } from './parts';
import { clamp01, motionTheme as t } from './motion-theme';

export const mediaPlaybackProps = (media, fps) => ({
  trimBefore: Math.round((media.trimStartSec ?? 0) * fps),
  muted: (media.audioMode ?? 'mute') === 'mute',
  objectFit: media.fit,
});

// leadFrames > 0 только у сцены с входом push: содержимое начинается за lead кадров до start.
// Видео остаётся в своём таймкоде: в кадре start (локальный кадр lead) клип показывает тот же
// кадр trimBefore, что и без перехода. Сдвинуть trimBefore назад нельзя (обычно он 0), поэтому
// видео стартует на lead кадров позже, а до start держится его первый кадр (Freeze, без звука).
export const mediaClipFrame = ({ localFrame, lead = 0, trimBefore = 0 }) => ({
  clipFrame: trimBefore + Math.max(0, localFrame - lead),
  hold: localFrame < lead,
});

export const MediaScene = ({ media, overlayText, caption, durationInFrames, leadFrames = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const overlayEntry = useEntrance(durationInFrames, 1, 2);
  const presentation = mediaPlaybackProps(media, fps);
  // Огибающая звука клипа – по номинальной длине сцены из ТЗ, как без перехода.
  const clipDuration = Math.max(1, durationInFrames - leadFrames);
  const volume = presentation.muted ? undefined : (localFrame) => brollClipVolume({
    mode: media.audioMode, localFrame, durationInFrames: clipDuration, fps,
  });
  const delayed = (video) => {
    if (!leadFrames) return video;
    if (mediaClipFrame({ localFrame: frame, lead: leadFrames }).hold) return <Freeze frame={0}>{video}</Freeze>;
    return <Sequence from={leadFrames} layout="none">{video}</Sequence>;
  };
  if (media.kind === 'video' && media.frame === 'full') {
    // Full frame: an edge-to-edge layer (e.g. a project-local motion pack) with no card, no zoom.
    return <AbsoluteFill>
      {delayed(<OffthreadVideo src={staticFile(media.src)} trimBefore={presentation.trimBefore}
        muted={presentation.muted} volume={volume}
        style={{ width: '100%', height: '100%', objectFit: presentation.objectFit }} />)}
    </AbsoluteFill>;
  }
  const zoom = 1 + 0.025 * clamp01(frame / Math.max(1, durationInFrames - 1));
  // Contain preserves every reviewed image edge; cover allows a restrained camera move.
  const style = { width: '100%', height: '100%', objectFit: presentation.objectFit,
    transform: `scale(${media.fit === 'cover' ? zoom : 1})` };
  return <SceneFrame caption={caption}>
    <div style={{ height: overlayText ? 600 : 890, flexShrink: 0, borderRadius: t.radius,
      overflow: 'hidden', background: t.panel, border: `1px solid ${t.line}`,
    }}>
      {media.kind === 'image' ? <Img src={staticFile(media.src)} style={style} /> : delayed(<OffthreadVideo
        src={staticFile(media.src)} trimBefore={presentation.trimBefore} muted={presentation.muted}
        volume={volume} style={style}
      />)}
    </div>
    {overlayText && <TextBox text={overlayText} height={300} maxSize={72} weight={750} style={overlayEntry} />}
  </SceneFrame>;
};
