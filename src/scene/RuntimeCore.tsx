import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  TorusGeometry,
} from 'three'
import { PALETTE } from '../entities/palette'
import { CORE_POS, SPAWN_POS } from '../simulation/layout'
import { session } from '../simulation/session'
import { makeShellMaterial } from './materials'
import { ripple } from './registry'

/**
 * The scheduler's heart. Goroutines hatch from its mouth. Its rings turn with
 * the colony's pulse and grind to a halt when everything is asleep.
 */
export function RuntimeCore() {
  const root = useRef<Group>(null)
  const rings = useRef<Group>(null)
  const heart = useRef<Mesh>(null)
  const shell = useRef<Mesh>(null)
  const procs = useRef<Group>(null)
  const mouth = useRef<Mesh>(null)
  const kick = useRef(0)
  const spin = useRef(0)

  const mats = useMemo(
    () => ({
      shell: makeShellMaterial({ base: '#0a1016', tint: '#00add8', rim: 1.2 }),
      wire: new MeshBasicMaterial({ color: new Color('#00add8').multiplyScalar(0.55), wireframe: true, transparent: true, opacity: 0.5, toneMapped: false }),
      heart: new MeshBasicMaterial({ color: new Color('#7fe3ff').multiplyScalar(2.2), toneMapped: false }),
      ring: new MeshBasicMaterial({ color: new Color('#00add8').multiplyScalar(1.2), toneMapped: false, transparent: true, opacity: 0.85 }),
      ringDim: new MeshBasicMaterial({ color: new Color('#2b5566'), toneMapped: false, transparent: true, opacity: 0.6, side: DoubleSide }),
      mouth: new MeshBasicMaterial({ color: new Color('#00add8'), toneMapped: false, transparent: true, opacity: 0.0, blending: AdditiveBlending, side: DoubleSide, depthWrite: false }),
      proc: new MeshBasicMaterial({ color: new Color('#9feaff').multiplyScalar(1.6), toneMapped: false }),
    }),
    [],
  )

  useEffect(
    () =>
      session.bus.subscribe((e) => {
        if (e.type === 'GOROUTINE_SPAWN' && e.at === 'core') {
          kick.current = 1
          ripple(SPAWN_POS[0], SPAWN_POS[2], PALETTE.go, 1.2)
        }
      }),
    [],
  )

  useFrame(() => {
    const dt = session.frameDt
    const life = session.fx.life
    const t = session.clock
    kick.current = Math.max(0, kick.current - dt * 1.8)
    spin.current += dt * (0.25 + kick.current * 2.5) * life

    const r = rings.current!
    r.children.forEach((c, i) => {
      c.rotation.z = spin.current * (i % 2 ? -1 : 1) * (0.6 + i * 0.25)
    })
    heart.current!.rotation.set(spin.current * 0.7, spin.current * 1.1, 0)
    const pulse = 1 + Math.sin(t * 2.2) * 0.05 * life + kick.current * 0.35
    heart.current!.scale.setScalar(pulse)
    ;(mats.heart.color as Color).set('#7fe3ff').multiplyScalar((1.2 + kick.current * 3) * (0.35 + 0.65 * life))
    shell.current!.rotation.y = -spin.current * 0.4
    procs.current!.rotation.y = spin.current * 1.4
    mats.mouth.opacity = kick.current * 0.9
    mouth.current!.scale.setScalar(1 + (1 - kick.current) * 0.6)
    root.current!.position.y = Math.sin(t * 0.6) * 0.04 * life
  })

  return (
    <group position={CORE_POS}>
      <group ref={root}>
        {/* floor rings: run queues */}
        {[1.7, 2.25, 2.9].map((rad, i) => (
          <mesh key={rad} rotation-x={-Math.PI / 2} position-y={0.015} material={mats.ringDim}>
            <ringGeometry args={[rad, rad + 0.025 + i * 0.008, 96, 1, i * 0.7, Math.PI * (1.4 + i * 0.2)]} />
          </mesh>
        ))}

        {/* plinth */}
        <mesh position-y={0.18} material={mats.shell}>
          <cylinderGeometry args={[1.25, 1.45, 0.36, 48]} />
        </mesh>
        <mesh position-y={0.37} rotation-x={-Math.PI / 2} material={mats.ring}>
          <ringGeometry args={[1.12, 1.17, 64]} />
        </mesh>

        {/* orbiting rings */}
        <group ref={rings} position-y={1.75}>
          {[1.05, 0.85, 1.3].map((rad, i) => (
            <mesh key={i} rotation={[Math.PI / 2 + (i - 1) * 0.5, i * 0.9, 0]} material={i === 1 ? mats.ring : mats.ringDim}>
              <torusGeometry args={[rad, i === 1 ? 0.012 : 0.008, 6, 96]} />
            </mesh>
          ))}
        </group>

        {/* lattice shell + heart */}
        <mesh ref={shell} position-y={1.75} material={mats.wire} geometry={useMemo(() => new IcosahedronGeometry(0.62, 1), [])} />
        <mesh ref={heart} position-y={1.75} material={mats.heart}>
          <icosahedronGeometry args={[0.2, 0]} />
        </mesh>

        {/* P's: four processors in orbit (GOMAXPROCS) */}
        <group ref={procs} position-y={1.75}>
          {[0, 1, 2, 3].map((i) => (
            <mesh key={i} position={[Math.cos((i * Math.PI) / 2) * 0.95, 0, Math.sin((i * Math.PI) / 2) * 0.95]} material={mats.proc}>
              <boxGeometry args={[0.06, 0.06, 0.06]} />
            </mesh>
          ))}
        </group>

        {/* stem */}
        <mesh position-y={0.95} material={mats.shell}>
          <cylinderGeometry args={[0.07, 0.22, 1.2, 12]} />
        </mesh>
      </group>

      {/* hatch mouth, flashes on `go` */}
      <mesh
        ref={mouth}
        position={[SPAWN_POS[0] - CORE_POS[0], 0.03, SPAWN_POS[2] - CORE_POS[2]]}
        rotation-x={-Math.PI / 2}
        material={mats.mouth}
        geometry={useMemo(() => new RingGeometry(0.25, 0.42, 48), [])}
      />
      <mesh position={[SPAWN_POS[0] - CORE_POS[0], 0.02, SPAWN_POS[2] - CORE_POS[2]]} rotation-x={-Math.PI / 2} material={mats.ringDim}>
        <ringGeometry args={[0.5, 0.52, 48]} />
      </mesh>
      <TorusMarker />
    </group>
  )
}

/** Thin standing arch over the hatch mouth. */
function TorusMarker() {
  const geo = useMemo(() => new TorusGeometry(0.62, 0.012, 6, 48, Math.PI), [])
  const mat = useMemo(() => new MeshBasicMaterial({ color: new Color('#2f6f86'), toneMapped: false }), [])
  return <mesh geometry={geo} material={mat} position={[SPAWN_POS[0] - CORE_POS[0], 0, SPAWN_POS[2] - CORE_POS[2]]} />
}
