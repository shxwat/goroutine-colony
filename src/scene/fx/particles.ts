import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Points, ShaderMaterial, Vector3 } from 'three'

/**
 * One shared spark pool for every burst in the colony (spawns, dissolves,
 * payload absorption, races). Fixed-size ring buffer, one draw call.
 */
const COUNT = 1600

const pos = new Float32Array(COUNT * 3)
const vel = new Float32Array(COUNT * 3)
const color = new Float32Array(COUNT * 3)
const life = new Float32Array(COUNT) // remaining seconds
const maxLife = new Float32Array(COUNT)
const alpha = new Float32Array(COUNT)
let head = 0

const geo = new BufferGeometry()
geo.setAttribute('position', new BufferAttribute(pos, 3))
geo.setAttribute('color', new BufferAttribute(color, 3))
geo.setAttribute('aAlpha', new BufferAttribute(alpha, 1))

export const sparkPoints = new Points(
  geo,
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexColors: true,
    uniforms: { uPx: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      uniform float uPx;
      varying vec3 vC;
      varying float vA;
      void main() {
        vC = color;
        vA = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uPx * (2.0 + aAlpha * 3.0) * (10.0 / -mv.z);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vC;
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * vA;
        gl_FragColor = vec4(vC * a * 2.2, 1.0);
      }
    `,
  }),
)
sparkPoints.frustumCulled = false

export function emitBurst(at: Vector3, c: Color, count: number, speed = 1, opts: { up?: number; spread?: number; life?: number } = {}) {
  const up = opts.up ?? 0.6
  const spread = opts.spread ?? 0.05
  for (let n = 0; n < count; n++) {
    const i = head
    head = (head + 1) % COUNT
    const th = Math.random() * Math.PI * 2
    const ph = Math.acos(2 * Math.random() - 1)
    const sp = speed * (0.3 + Math.random() * 0.9)
    pos[i * 3] = at.x + (Math.random() - 0.5) * spread
    pos[i * 3 + 1] = at.y + (Math.random() - 0.5) * spread
    pos[i * 3 + 2] = at.z + (Math.random() - 0.5) * spread
    vel[i * 3] = Math.sin(ph) * Math.cos(th) * sp
    vel[i * 3 + 1] = Math.abs(Math.cos(ph)) * sp * up + up * 0.4
    vel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * sp
    color[i * 3] = c.r
    color[i * 3 + 1] = c.g
    color[i * 3 + 2] = c.b
    const l = (opts.life ?? 1.1) * (0.6 + Math.random() * 0.6)
    life[i] = l
    maxLife[i] = l
  }
}

export function updateSparks(dt: number, px: number) {
  ;(sparkPoints.material as ShaderMaterial).uniforms.uPx.value = px
  const drag = Math.exp(-dt * 2.2)
  for (let i = 0; i < COUNT; i++) {
    if (life[i] <= 0) {
      alpha[i] = 0
      continue
    }
    life[i] -= dt
    vel[i * 3] *= drag
    vel[i * 3 + 1] = vel[i * 3 + 1] * drag - dt * 0.4
    vel[i * 3 + 2] *= drag
    pos[i * 3] += vel[i * 3] * dt
    pos[i * 3 + 1] = Math.max(0.02, pos[i * 3 + 1] + vel[i * 3 + 1] * dt)
    pos[i * 3 + 2] += vel[i * 3 + 2] * dt
    const k = life[i] / maxLife[i]
    alpha[i] = Math.max(0, k * k)
  }
  geo.attributes.position.needsUpdate = true
  geo.attributes.aAlpha.needsUpdate = true
  geo.attributes.color.needsUpdate = true
}

export function clearSparks() {
  life.fill(0)
  alpha.fill(0)
}
