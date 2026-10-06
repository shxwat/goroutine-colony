import { Html } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  ShaderMaterial,
  TorusGeometry,
  TubeGeometry,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from 'three'
import { PALETTE } from '../entities/palette'
import { channelFrame, slotU } from '../simulation/layout'
import { session } from '../simulation/session'
import { useColony } from '../store/colonyStore'
import { ConduitCurve, conduitPulses } from './curves'
import { makeShellMaterial } from './materials'
import { ripple } from './registry'

const MAX_PULSES = 6
const TUBE_R = 0.2

/**
 * A channel as a physical conduit: a glass tube on pylons, ribbed like a
 * trachea, with a send port and a receive port. Buffered channels grow
 * visible cradles — one per slot. Unbuffered channels have a single iris in
 * the middle that only flashes when two goroutines meet.
 */
export function Channel({ name }: { name: string }) {
  const ch = session.world.channels.get(name)!
  const frame = useMemo(() => channelFrame(ch.layout), [ch])
  const curve = useMemo(() => new ConduitCurve(frame), [frame])
  const cap = ch.cap

  const glass = useMemo(() => makeGlassMaterial(), [])
  const filament = useMemo(() => makeFilamentMaterial(), [])
  const shell = useMemo(() => makeShellMaterial({ base: '#0b1117', tint: '#3b6b80', rim: 1.1 }), [])
  const tubeGeo = useMemo(() => new TubeGeometry(curve, 120, TUBE_R, 24, false), [curve])
  const coreGeo = useMemo(() => new TubeGeometry(curve, 120, 0.016, 6, false), [curve])

  const ribs = useMemo(() => {
    const count = Math.max(6, Math.round(frame.length / 0.42))
    const mesh = new InstancedMesh(new TorusGeometry(TUBE_R + 0.018, 0.016, 6, 28), shell, count)
    const m = new Matrix4()
    const q = new Quaternion()
    const z = new Vector3(0, 0, 1)
    for (let i = 0; i < count; i++) {
      const u = 0.06 + (i / (count - 1)) * 0.88
      const pos = curve.getPoint(u)
      q.setFromUnitVectors(z, curve.getTangent(u))
      m.compose(pos, q, new Vector3(1, 1, 1))
      mesh.setMatrixAt(i, m)
    }
    return mesh
  }, [curve, frame, shell])

  const portMats = useMemo(
    () => [0, 1].map(() => new MeshBasicMaterial({ color: new Color('#00add8'), toneMapped: false })),
    [],
  )
  const slotMats = useMemo(
    () => Array.from({ length: cap }, () => new MeshBasicMaterial({ color: new Color('#29424f'), toneMapped: false })),
    [cap],
  )
  const irisMat = useMemo(
    () => new MeshBasicMaterial({ color: new Color('#ffffff'), toneMapped: false, transparent: true, blending: AdditiveBlending, depthWrite: false }),
    [],
  )
  const iris = useRef<Mesh>(null)
  const flash = useRef(0)
  const reveal = useRef(0)
  const fullFlash = useRef(0)
  const label = useRef<HTMLDivElement>(null)
  const setHover = useColony((s) => s.setHover)

  useEffect(
    () =>
      session.bus.subscribe((e) => {
        if (e.type === 'CHANNEL_SEND' && e.ch === name) {
          if (e.to != null) {
            flash.current = 1
            const mid = curve.getPoint(0.5)
            ripple(mid.x, mid.z, PALETTE.go, 1.4)
          } else {
            ripple(frame.a[0], frame.a[2], PALETTE.payload, 0.7)
          }
        }
        if (e.type === 'CHANNEL_BUFFER_FULL' && e.ch === name) fullFlash.current = 1
      }),
    [name, curve, frame],
  )

  useFrame(() => {
    const dt = session.frameDt
    const world = session.world
    const life = session.fx.life
    const model = world.channels.get(name)
    if (!model) return
    reveal.current = Math.min(1, reveal.current + dt * 0.9)
    flash.current = Math.max(0, flash.current - dt * 1.6)
    fullFlash.current = Math.max(0, fullFlash.current - dt * 1.2)

    const pulses = conduitPulses.get(name) ?? []
    for (const mat of [glass, filament]) {
      const u = mat.uniforms
      u.uReveal.value = easeInOut(reveal.current)
      u.uTime.value = session.clock
      u.uLife.value = life
      u.uFlash.value = flash.current
      for (let i = 0; i < MAX_PULSES; i++) u.uPulses.value[i] = pulses[i] ?? -10
    }

    // ports: send port turns ember while senders are stuck behind it
    const senders = world.queue(name, 'chan send')
    const receivers = world.queue(name, 'chan receive')

    // a jammed conduit runs hot: glass, filament and ribs shift toward ember and throb
    const jammed = senders.some((g) => g.state === 'BLOCKED')
    const throb = jammed ? 0.75 + 0.25 * Math.sin(session.clock * 5) : 1
    const tintTarget = tmpC.copy(PALETTE.go).lerp(PALETTE.ember, jammed ? 0.7 : 0).multiplyScalar(throb)
    const k = 1 - Math.exp(-dt * 3)
    glass.uniforms.uTint.value.lerp(tintTarget, k)
    filament.uniforms.uTint.value.lerp(tintTarget, k)
    shell.uniforms.uTint.value.lerp(tmpC.set(jammed ? '#a8352a' : '#3b6b80'), k)
    const sendCol = senders.some((g) => g.state === 'BLOCKED') ? PALETTE.ember : PALETTE.go
    const recvCol = receivers.length ? PALETTE.amber : PALETTE.go
    portMats[0].color.lerp(tmpC.copy(sendCol).multiplyScalar(senders.length ? 2.2 : 1.1), 1 - Math.exp(-dt * 6))
    portMats[1].color.lerp(tmpC.copy(recvCol).multiplyScalar(receivers.length ? 2 : 1.1), 1 - Math.exp(-dt * 6))

    slotMats.forEach((m, i) => {
      const full = i < model.buffer.length
      const target = full
        ? tmpC.copy(model.buffer.length === cap ? PALETTE.ember : PALETTE.payload).multiplyScalar(1.6 + fullFlash.current * 2)
        : tmpC.set('#24404d')
      m.color.lerp(target, 1 - Math.exp(-dt * 8))
    })

    if (iris.current) {
      irisMat.opacity = 0.12 + flash.current
      iris.current.scale.setScalar(1 + flash.current * 0.5)
    }

    if (label.current) {
      const buf = cap > 0 ? `${model.buffer.length}/${cap}` : senders.length ? 'sender waiting' : receivers.length ? 'receiver waiting' : 'idle'
      label.current.dataset.state = senders.some((g) => g.state === 'BLOCKED') ? 'hot' : receivers.length ? 'warm' : ''
      const el = label.current.querySelector('[data-buf]')
      if (el && el.textContent !== buf) el.textContent = buf
    }
  })

  const hover = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    setHover({ kind: 'channel', id: name })
  }

  const mid = curve.getPoint(0.5)
  const ends = [
    { u: 0, pos: curve.getPoint(0), tan: curve.getTangent(0).negate() },
    { u: 1, pos: curve.getPoint(1), tan: curve.getTangent(1) },
  ]

  return (
    <group>
      <mesh geometry={tubeGeo} material={glass} onPointerMove={hover} onPointerOut={() => setHover(null)} />
      <mesh geometry={coreGeo} material={filament} />
      <primitive object={ribs} />

      {ends.map(({ u, pos, tan }, i) => (
        <group key={u} position={pos} quaternion={new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), tan)}>
          {/* flared mouth */}
          <mesh material={shell} position-y={0.06} geometry={funnelGeo}>
          </mesh>
          <mesh material={portMats[i]} position-y={0.17} rotation-x={Math.PI / 2}>
            <torusGeometry args={[0.32, 0.016, 8, 40]} />
          </mesh>
          <mesh material={portMats[i]} position-y={-0.02} rotation-x={Math.PI / 2}>
            <torusGeometry args={[TUBE_R + 0.03, 0.01, 6, 32]} />
          </mesh>
        </group>
      ))}

      {/* pylons */}
      {ends.map(({ u, pos }) => (
        <group key={`py${u}`} position={[pos.x, 0, pos.z]}>
          <mesh material={shell} position-y={(pos.y - TUBE_R) / 2}>
            <cylinderGeometry args={[0.035, 0.07, pos.y - TUBE_R, 8]} />
          </mesh>
          <mesh material={shell} position-y={0.03}>
            <cylinderGeometry args={[0.2, 0.26, 0.06, 20]} />
          </mesh>
        </group>
      ))}

      {/* buffer cradles */}
      {Array.from({ length: cap }, (_, i) => {
        const u = slotU(i, cap)
        const pos = curve.getPoint(u)
        const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), curve.getTangent(u))
        return (
          <group key={i} position={pos} quaternion={q}>
            {[-0.13, 0.13].map((z) => (
              <mesh key={z} position-z={z} material={slotMats[i]}>
                <torusGeometry args={[TUBE_R + 0.05, 0.022, 8, 32]} />
              </mesh>
            ))}
            <mesh position-y={-(TUBE_R + 0.11)} material={slotMats[i]}>
              <boxGeometry args={[0.07, 0.07, 0.07]} />
            </mesh>
          </group>
        )
      })}
      {cap > 0 &&
        Array.from({ length: cap }, (_, i) => {
          const pos = curve.getPoint(slotU(i, cap))
          return (
            <mesh key={`plate${i}`} position={[pos.x, 0.014, pos.z]} rotation-x={-Math.PI / 2} material={slotMats[i]}>
              <ringGeometry args={[0.2, 0.235, 4, 1, Math.PI / 4]} />
            </mesh>
          )
        })}

      {/* rendezvous iris for unbuffered channels */}
      {cap === 0 && (
        <mesh ref={iris} position={mid} quaternion={new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), curve.getTangent(0.5))} material={irisMat}>
          <torusGeometry args={[TUBE_R + 0.09, 0.014, 6, 40]} />
        </mesh>
      )}

      {/* ground shadow rail */}
      <mesh position={[mid.x, 0.011, mid.z]} rotation={[-Math.PI / 2, 0, -Math.atan2(frame.dir[1], frame.dir[0])]}>
        <planeGeometry args={[frame.length + 0.4, 0.62]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.35} depthWrite={false} side={DoubleSide} />
      </mesh>

      <Html position={[mid.x - frame.dir[1] * 0.9, 0.05, mid.z + frame.dir[0] * 0.9]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
        <div ref={label} className="world-label">
          <span className="wl-name">{name}</span>
          <span className="wl-type">chan {ch.elem}{cap > 0 ? `, ${cap}` : ''}</span>
          <span className="wl-buf" data-buf>
            {cap > 0 ? `0/${cap}` : 'idle'}
          </span>
        </div>
      </Html>
    </group>
  )
}

const tmpC = new Color()
const funnelGeo = new CylinderGeometry(0.31, TUBE_R + 0.02, 0.22, 28, 1, true)

const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)

function conduitUniforms() {
  return UniformsUtils.merge([
    UniformsLib.fog,
    {
      uReveal: { value: 0 },
      uTime: { value: 0 },
      uLife: { value: 1 },
      uFlash: { value: 0 },
      uPulses: { value: new Array(MAX_PULSES).fill(-10) },
      uTint: { value: new Color('#00add8') },
      uGold: { value: PALETTE.payload.clone() },
    },
  ])
}

const conduitVertex = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vW;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vW = world.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`

const pulseFn = /* glsl */ `
  uniform float uPulses[${MAX_PULSES}];
  float pulseAt(float u, float w) {
    float s = 0.0;
    for (int i = 0; i < ${MAX_PULSES}; i++) s += exp(-pow((u - uPulses[i]) / w, 2.0));
    return s;
  }
`

function makeGlassMaterial() {
  return new ShaderMaterial({
    fog: true,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: conduitUniforms(),
    vertexShader: conduitVertex,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform float uReveal, uTime, uLife, uFlash;
      uniform vec3 uTint, uGold;
      ${pulseFn}
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vW;
      void main() {
        if (vUv.x > uReveal) discard;
        vec3 n = normalize(vN);
        vec3 v = normalize(cameraPosition - vW);
        float fres = pow(1.0 - abs(dot(n, v)), 2.0);
        float stripes = smoothstep(0.92, 1.0, sin(vUv.y * 6.2831 * 6.0)) * 0.35;
        float flow = 0.5 + 0.5 * sin(vUv.x * 60.0 - uTime * 3.0 * uLife);
        float edge = smoothstep(uReveal - 0.04, uReveal, vUv.x) * step(uReveal, 0.999);
        float p = pulseAt(vUv.x, 0.05);
        vec3 col = uTint * (fres * 0.65 + stripes * fres * flow * 0.6);
        col += uGold * p * (0.25 + fres * 0.8);
        col += vec3(1.0) * uFlash * fres * 1.2;
        col += uTint * edge * 2.0;
        float a = clamp(fres * 0.55 + 0.06 + p * 0.15 + edge, 0.0, 1.0);
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  })
}

function makeFilamentMaterial() {
  return new ShaderMaterial({
    fog: true,
    toneMapped: false,
    uniforms: conduitUniforms(),
    vertexShader: conduitVertex,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform float uReveal, uTime, uLife, uFlash;
      uniform vec3 uTint, uGold;
      ${pulseFn}
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vW;
      void main() {
        if (vUv.x > uReveal) discard;
        float p = pulseAt(vUv.x, 0.07);
        float travel = smoothstep(0.96, 1.0, fract(vUv.x * 3.0 - uTime * 0.35)) * uLife;
        vec3 col = uTint * (0.35 + travel * 0.8) + uGold * p * 2.5 + vec3(1.0) * uFlash * 2.0;
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }
    `,
  })
}
