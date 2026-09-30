import { Reveal } from './Reveal'
import { CONFIG } from '../config'

/** Hero mascot portrait on the right (Cindy-style split). Placeholder SVG now;
 *  swap CONFIG.heroChara to a real transparent Pixiu WebP when ready. */
export function HeroCharacter() {
  return (
    <Reveal as="div" delay={160} className="hero__visual">
      <img
        className="hero-chara lp-float"
        src={CONFIG.heroChara}
        alt="貔貅 · TMarks 守藏神兽"
        draggable={false}
      />
    </Reveal>
  )
}
