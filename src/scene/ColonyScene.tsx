import { Canvas, useFrame } from '@react-three/fiber'
import { PerformanceMonitor } from '@react-three/drei'
import { Suspense, useState } from 'react'
import { ACESFilmicToneMapping } from 'three'
import { LIVE_SHOT, SCENARIOS } from '../scenarios'
import { session } from '../simulation/session'
import { useColony } from '../store/colonyStore'
import { CameraDirector } from './CameraDirector'
import { Channel } from './Channel'
import { Colony } from './Colony'
import { Dust } from './Dust'
import { Floor } from './Floor'
import { FxDirector } from './fx/FxDirector'
import { PostFx } from './fx/PostFx'
import { MemoryCell } from './MemoryCell'
import { MutexChamber } from './MutexChamber'
import { Payloads } from './Payloads'
import { ResultBadges } from './ResultBadges'
import { RuntimeCore } from './RuntimeCore'
import { Links } from './Links'

/** Advances the event source exactly once per frame, before anything renders. */
function SimDriver() {
  useFrame((_, delta) => session.tick(delta), -10)
  return null
}

function Resources() {
  const { channels, mutexes, memory } = useColony((s) => s.resources)
  return (
    <>
      {channels.map((n) => (
        <Channel key={n} name={n} />
      ))}
      {mutexes.map((n) => (
        <MutexChamber key={n} name={n} />
      ))}
      {memory.map((n) => (
        <MemoryCell key={n} name={n} />
      ))}
    </>
  )
}

export function ColonyScene() {
  const sceneKey = useColony((s) => s.sceneKey)
  const live = useColony((s) => s.live != null)
  const scenarioId = useColony((s) => s.scenarioId)
  const select = useColony((s) => s.select)
  const shot = live ? LIVE_SHOT : SCENARIOS.find((s) => s.id === scenarioId)!.shot
  // 1.5 holds 120Hz on an M-series laptop; weaker GPUs step down instead of stuttering
  const [dpr, setDpr] = useState(1.5)

  return (
    <Canvas
      className="colony-canvas"
      dpr={dpr}
      gl={{ antialias: false, powerPreference: 'high-performance', toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      camera={{ fov: 38, near: 0.1, far: 120, position: [0, 9, 16] }}
      onPointerMissed={() => select(null)}
      onCreated={({ gl, camera }) => {
        if (import.meta.env.DEV) Object.assign((window as unknown as { __colony: object }).__colony ?? {}, { gl, camera })
      }}
    >
      <color attach="background" args={['#030508']} />
      <fogExp2 attach="fog" args={['#030508', 0.042]} />
      <PerformanceMonitor flipflops={3} onDecline={() => setDpr((d) => Math.max(1, d - 0.25))} onFallback={() => setDpr(1)} />
      <SimDriver />
      <Suspense fallback={null}>
        <Floor />
        <Dust />
        <RuntimeCore />
        <group key={sceneKey}>
          <Resources />
          <Colony />
          <Payloads />
          <Links />
          <FxDirector />
          <ResultBadges />
        </group>
        <CameraDirector shot={shot} />
        <PostFx />
      </Suspense>
    </Canvas>
  )
}
