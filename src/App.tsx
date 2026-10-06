import { useAudioBridge } from './audio/useAudioBridge'
import { ColonyScene } from './scene/ColonyScene'
import { useSessionBridge } from './store/bridge'
import { Overlay } from './ui/Overlay'
import { useKeyboard } from './ui/useKeyboard'

export function App() {
  useSessionBridge()
  useAudioBridge()
  useKeyboard()
  return (
    <main className="app">
      <ColonyScene />
      <Overlay />
      <div className="curtain" />
    </main>
  )
}
