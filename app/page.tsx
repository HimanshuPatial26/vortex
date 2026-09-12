/* Demo page. Everything visible here comes from HeroVortex's props, so this
   doubles as the worked example for dropping the hero into your own site. */

import HeroVortex from "./components/HeroVortex";
import { color, font, radius } from "./theme";

export default function Page() {
  return (
    <HeroVortex
      actions={
        <>
          <a
            href="https://github.com/HimanshuPatial26/vortex"
            style={{
              padding: "11px 22px",
              borderRadius: radius.pill,
              background: color.text,
              color: color.ink,
              fontFamily: font.body,
              fontSize: 13.5,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            View the source
          </a>
          <a
            href="#how"
            style={{
              padding: "11px 22px",
              borderRadius: radius.pill,
              border: `1px solid ${color.borderInput}`,
              color: color.textDim,
              fontFamily: font.body,
              fontSize: 13.5,
              textDecoration: "none",
            }}
          >
            How it works
          </a>
        </>
      }
    />
  );
}
