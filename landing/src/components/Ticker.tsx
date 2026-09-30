const ITEM = (
  <>
    <span><i className="dot dot--live" /> TMARKS // ONLINE</span><span className="sep">◆</span>
    <span>CLOUDFLARE_EDGE</span><span className="sep">◆</span>
    <span>AGENT_READY</span><span className="sep">◆</span>
    <span>SYNC_OK</span><span className="sep">◆</span>
  </>
)

// One half is repeated enough to exceed common viewport widths, so the bar
// never runs empty during the -50% loop. Two identical halves + translateX(-50%)
// gives a seamless infinite scroll (each half carries its own trailing gap).
function TickerHalf() {
  return (
    <div className="ticker__half">
      {ITEM}{ITEM}{ITEM}{ITEM}{ITEM}
    </div>
  )
}

export function Ticker() {
  return (
    <div className="ticker" aria-hidden>
      <div className="ticker__track">
        <TickerHalf /><TickerHalf />
      </div>
    </div>
  )
}
