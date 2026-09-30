import { Nav } from './components/Nav'
import { Ticker } from './components/Ticker'
import { Hero } from './components/Hero'
import { Features } from './components/Features'
import { Snapshot } from './components/Snapshot'
import { Organize } from './components/Organize'
import { Sync } from './components/Sync'
import { Manifesto } from './components/Manifesto'
import { PopupShowcase } from './components/PopupShowcase'
import { Install } from './components/Install'
import { CtaBanner } from './components/CtaBanner'
import { Footer } from './components/Footer'

export function App() {
  return (
    <>
      <div className="fx-grain" aria-hidden />
      <div className="fx-scan" aria-hidden />
      <div className="fx-glow" aria-hidden><span /><span /></div>
      <Ticker />
      <Nav />
      <main id="top">
        <Hero />
        <Features />
        <Snapshot />
        <Organize />
        <Sync />
        <Manifesto />
        <PopupShowcase />
        <Install />
        <CtaBanner />
      </main>
      <Footer />
    </>
  )
}
