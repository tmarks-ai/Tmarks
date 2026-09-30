import { Reveal } from './Reveal'
import { CONFIG } from '../config'

/** Red manifesto section — the Pixiu reappears (Cindy reuses its character here).
 *  Statement: "只进不出 / 永不丢失" ties the mascot myth to the snapshot feature. */
export function Manifesto() {
  return (
    <section className="section section--manifesto manifesto">
      <div className="container manifesto__inner">
        <Reveal as="div">
          <img
            className="manifesto__chara lp-float"
            src={CONFIG.manifestoChara}
            alt="貔貅"
            draggable={false}
          />
          <h2 className="manifesto__title">只进不出，<br />永不丢失。</h2>
          <p className="manifesto__sub">
            貔貅守藏，来者皆收。你的每一个书签、每一窗标签页，一旦收纳便永不丢失——
            即便原链接 404，快照依旧在。
          </p>
        </Reveal>
      </div>
    </section>
  )
}
