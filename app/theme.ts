/* Design tokens for the hero. Only the values HeroVortex and the demo page
   actually use — swap the hex values for your own palette and the whole
   composition retints. ParticleVortex itself imports nothing from here; it
   takes its colours as props, so it drops into any project unchanged. */

export const color = {
  /* Grounds, darkest first. */
  ink:     "#06070C",
  surface: "#0B0C10",

  /* Type, brightest first. */
  text:      "#E8EAF2",
  textDim:   "#C8CEDE",
  textMuted: "#A8B0C4",
  textFaint: "#7C859B",
  textMono:  "#4A5266",
  textMono2: "#3D4557",

  /* The prismatic fringe the deep particles pick up. */
  accentLight: "#8FB4FF",

  /* Outlines. */
  borderInput: "#232B42",
} as const;

export const font = {
  display: "'Newsreader', Georgia, serif",
  body:    "'Instrument Sans', system-ui, sans-serif",
  mono:    "'JetBrains Mono', ui-monospace, monospace",
} as const;

export const radius = {
  pill: 999,
} as const;
