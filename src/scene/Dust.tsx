import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, ShaderMaterial } from 'three'
import { session } from '../simulation/session'

const COUNT = 650

/** Suspended motes. They drift while the colony lives and hang still when it doesn't. */
export function Dust() {
  const points = useMemo(() => {
    const pos = new Float32Array(COUNT * 3)
    const seed = new Float32Array(COUNT)
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 34
      pos[i * 3 + 1] = Math.random() * 7
      pos[i * 3 + 2] = (Math.random() - 0.5) * 26 - 1
      seed[i] = Math.random()
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(pos, 3))
    geo.setAttribute('aSeed', new BufferAttribute(seed, 1))
    const mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uPx: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float aSeed;
        uniform float uTime;
        uniform float uPx;
        varying float vA;
        void main() {
          vec3 p = position;
          float t = uTime * (0.08 + aSeed * 0.12);
          p.y = mod(p.y + t, 7.0);
          p.x += sin(t * 2.0 + aSeed * 40.0) * 0.4;
          p.z += cos(t * 1.7 + aSeed * 30.0) * 0.4;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = min(uPx * (1.0 + aSeed * 2.2) * (14.0 / -mv.z), uPx * 3.5);
          vA = smoothstep(0.0, 1.0, p.y) * smoothstep(7.0, 5.0, p.y) * (0.25 + aSeed * 0.5) * smoothstep(40.0, 8.0, -mv.z) * smoothstep(2.5, 6.0, -mv.z);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d) * vA;
          gl_FragColor = vec4(vec3(0.45, 0.7, 0.8) * a, 1.0);
        }
      `,
    })
    return new Points(geo, mat)
  }, [])

  // integrate our own time so the motes slow down and stop with the colony
  const clock = useMemo(() => ({ t: 0 }), [])
  useFrame(({ gl }) => {
    clock.t += session.frameDt * session.fx.life
    const u = (points.material as ShaderMaterial).uniforms
    u.uTime.value = clock.t
    u.uPx.value = gl.getPixelRatio()
  })

  return <primitive object={points} />
}
