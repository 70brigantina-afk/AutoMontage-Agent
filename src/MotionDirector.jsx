import { AbsoluteFill, Audio, Freeze, Sequence, staticFile, useVideoConfig } from 'remotion';
import { FontStyle } from './fonts';
import { sourceVolumeForFrame } from './scenes/BrollMedia';
import { KineticTitle } from './motion/KineticTitle';
import { CardScene } from './motion/CardScene';
import { StepsScene } from './motion/StepsScene';
import { ListScene } from './motion/ListScene';
import { ChartScene } from './motion/ChartScene';
import { CounterScene } from './motion/CounterScene';
import { MediaScene } from './motion/MediaScene';
import { CtaScene } from './motion/CtaScene';
import { motionTheme } from './motion/motion-theme';
import { TransitionSeries } from '@remotion/transitions';
import {
  contentFrameAt, getSceneTiming, hasSceneTransitions, planSceneTransitions, presentationFor,
  sceneHold, transitionLead,
} from './motion/transitions';

export const MOTION_COMPONENTS = {
  'kinetic-title': KineticTitle, card: CardScene, steps: StepsScene, list: ListScene,
  counter: CounterScene, media: MediaScene, cta: CtaScene, chart: ChartScene,
};

export const getMotionTiming = getSceneTiming;

const sceneElement = (scene, durationInFrames) => {
  const Component = MOTION_COMPONENTS[scene.scene];
  if (!Component) throw new Error(`Unknown motion scene: ${scene.scene}`);
  return <Component {...scene} durationInFrames={durationInFrames} />;
};

// Режим переходов: TransitionSeries ставит сцены подряд, поэтому паузы между сценами и старт
// первой сцены задаются offset. Содержимое сцены получает длительность из ТЗ (у push – плюс lead
// кадров до start, анимация входа начинается в start - lead). Всё после живой части – хвост под
// переход и пауза перед ним – стоп-кадр последнего живого кадра: Freeze держит картинку и глушит
// звук клипа, поэтому видео не продолжается и не обрывается в пустоту.
const renderSceneTransitions = ({ scenes, fps, width, height }) => {
  const plan = planSceneTransitions(scenes, fps);
  let cursor = 0;
  const items = [];
  plan.forEach(({ index, from, durationInFrames, transition }) => {
    const natural = cursor - (transition?.frames ?? 0);
    if (transition) {
      const { presentation, timing } = presentationFor(transition, { width, height });
      items.push(<TransitionSeries.Transition key={`t${index}`} presentation={presentation} timing={timing} />);
    }
    const lead = transitionLead(transition);
    const { liveFrames, freezeFrame } = sceneHold({ lead, nominal: getSceneTiming(scenes[index], fps).durationInFrames });
    const content = lead
      ? sceneElement({ ...scenes[index], leadFrames: lead }, liveFrames)
      : sceneElement(scenes[index], liveFrames);
    items.push(<TransitionSeries.Sequence key={`s${index}`} name={`motion-scene-${index}`}
      offset={from - natural} durationInFrames={durationInFrames}>
      <Freeze frame={freezeFrame} active={(frame) => contentFrameAt(frame, liveFrames) < frame}>
        {content}
      </Freeze>
    </TransitionSeries.Sequence>);
    cursor = from + durationInFrames;
  });
  return <TransitionSeries>{items}</TransitionSeries>;
};

export const MotionDirector = ({ theme = 'motion-neutral', scenes = [], audioSrc, draftPreview = false }) => {
  const { fps, width, height } = useVideoConfig();
  if (theme !== 'motion-neutral') throw new Error(`Unknown public motion theme: ${theme}`);
  const timedScenes = scenes.map((scene) => ({ scene, ...getMotionTiming(scene, fps),
    audioMode: scene.media?.kind === 'video' ? scene.media.audioMode ?? 'mute' : null,
  }));
  return <AbsoluteFill style={{ background: motionTheme.background, fontFamily: motionTheme.fontFamily }}>
    <FontStyle />
    {audioSrc && <Audio src={staticFile(audioSrc)} volume={(frame) => sourceVolumeForFrame({ frame, scenes: timedScenes, fps })} />}
    {hasSceneTransitions(scenes)
      ? renderSceneTransitions({ scenes, fps, width, height })
      : timedScenes.map(({ scene, from, durationInFrames }, index) => (
        <Sequence key={index} from={from} durationInFrames={durationInFrames}>
          {sceneElement(scene, durationInFrames)}
        </Sequence>
      ))}
    {draftPreview && <div data-draft-preview-watermark="true" style={{ position: 'absolute',
      top: '5%', left: '7%', zIndex: 1000, padding: '10px 18px', borderRadius: 8,
      color: motionTheme.ink, background: motionTheme.panel, fontWeight: 800,
      fontSize: width * 0.03, opacity: 0.8,
    }}>ЧЕРНОВИК</div>}
  </AbsoluteFill>;
};
