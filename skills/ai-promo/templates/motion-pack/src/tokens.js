// ДНК дизайна пакета. Меняй под ролик: палитру, шрифты, размеры. Файл без импортов –
// render.cjs читает отсюда TOTAL и размеры кадра.

// Длина ролика в кадрах = durationInFrames scaffold brief (= кадры саундтрека).
export const TOTAL = 690;
export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

// Палитра «Блокбастер»: чёрный, расплавленное золото, холодный электрический циан.
export const C = {
  bg: '#050608',
  ink: '#F4F1EA',
  gold: '#FFB23F',
  goldHot: '#FFE6A8',
  ember: '#FF6A1A',
  cyan: '#5FE3FF',
  muted: '#8B8F96',
};

// Шрифты движка с кириллицей (FontStyle из src/fonts движка).
export const FONT = { display: 'Onest', mono: 'JetBrains Mono' };

// Хромированный текст пишется одной строкой: при ширине 1080 не больше 112 px.
export const CHROME_MAX = 112;

// Безопасная зона 9:16: важное держи внутри, низ кадра закрывают элементы площадок.
export const SAFE = { top: 260, bottom: 1500, side: 80 };
