import { Fragment } from 'react'

const ITEMS = [
  'TMARKS', '一键书签', '标签页收纳', '网页快照',
  'AI 智能整理', '文件夹与标签', '多端同步', 'CONSIDER IT SAVED',
]

function MarqueeGroup() {
  return (
    <div className="marquee__group">
      {ITEMS.map((t) => (
        <Fragment key={t}>
          <span>{t}</span><i>◆</i>
        </Fragment>
      ))}
    </div>
  )
}

export function Marquee() {
  return (
    <div className="marquee" aria-hidden>
      <div className="marquee__track">
        <MarqueeGroup /><MarqueeGroup />
      </div>
    </div>
  )
}
