import { Chart } from '../details/index.js';
import { CONTENT_WIDTH, Panel, SceneFrame, TextBox } from './parts';
import { motionTheme as t } from './motion-theme';

const PANEL_PADDING = 38;
const CHART_HEIGHT = 700;

// Значения и подписи берутся из ТЗ дословно; цвета и шрифт – из motionTheme.
export const ChartScene = ({ title, chartType = 'bar', points, unit, highlight, caption, durationInFrames }) => <SceneFrame caption={caption}>
  <TextBox text={title} height={220} maxSize={64} weight={700} />
  <Panel style={{ padding: PANEL_PADDING }}>
    <Chart points={points} chartType={chartType} unit={unit} highlight={highlight}
      theme={t} width={CONTENT_WIDTH - PANEL_PADDING * 2} height={CHART_HEIGHT}
      durationInFrames={durationInFrames} />
  </Panel>
</SceneFrame>;
