import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import { Color, ShaderMaterial, UniformsLib, UniformsUtils, Vector2, Vector4 } from 'three'
import { CORE_POS } from '../simulation/layout'
import { session } from '../simulation/session'
import { ripples } from './registry'

const RIPPLES = 8

/**
 * The substrate: a dark etched plane with a fine dot lattice, faint traces and
 * ring waves when the runtime does something. It reads like a die under a
 * microscope rather than a grid floor.
 */
export function Floor() {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        fog: true,
        uniforms: UniformsUtils.merge([
          UniformsLib.fog,
          {
            uTime: { value: 0 },
            uLife: { value: 1 },
            uCore: { value: new Vector2(CORE_POS[0], CORE_POS[2]) },
            uRipples: { value: Array.from({ length: RIPPLES }, () => new Vector4(0, 0, -100, 0)) },
            uRippleColors: { value: Array.from({ length: RIPPLES }, () => new Color()) },
            uBase: { value: new Color('#05080b') },
            uDot: { value: new Color('#2c4452') },
            uGo: { value: new Color('#00add8') },
          },
        ]),
        vertexShader: /* glsl */ `
          #include <common>
          #include <fog_pars_vertex>
          varying vec3 vW;
          void main() {
            vec4 world = modelMatrix * vec4(position, 1.0);
            vW = world.xyz;
            vec4 mvPosition = viewMatrix * world;
            gl_Position = projectionMatrix * mvPosition;
            #include <fog_vertex>
          }
        `,
        fragmentShader: /* glsl */ `
          #include <common>
          #include <fog_pars_fragment>
          uniform float uTime;
          uniform float uLife;
          uniform vec2 uCore;
          uniform vec4 uRipples[${RIPPLES}];
          uniform vec3 uRippleColors[${RIPPLES}];
          uniform vec3 uBase;
          uniform vec3 uDot;
          uniform vec3 uGo;
          varying vec3 vW;

          float lines(vec2 p, float s) {
            vec2 q = p / s;
            vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q);
            return 1.0 - min(min(g.x, g.y), 1.0);
          }
          float dots(vec2 p, float s, float r) {
            vec2 c = (fract(p / s) - 0.5) * s;
            float fw = fwidth(p.x) * 1.2;
            return 1.0 - smoothstep(r - fw, r + fw, length(c));
          }
          float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

          void main() {
            vec2 p = vW.xz;
            float r = length(p - vec2(0.0, -1.0));
            float focus = exp(-r * r / 260.0);

            vec3 col = uBase * (0.55 + 0.45 * focus);

            // lattice
            float d = dots(p, 0.5, 0.018) * 0.55 + dots(p, 2.0, 0.035) * 0.6;
            col += uDot * d * (0.25 + 0.75 * focus);
            col += uDot * lines(p, 4.0) * 0.07 * focus;

            // sparse etched traces on a coarse cell grid
            vec2 cell = floor(p / 2.0);
            float h = hash(cell);
            vec2 f = fract(p / 2.0);
            float tr = 0.0;
            if (h > 0.72) tr = 1.0 - smoothstep(0.0, fwidth(p.x) * 0.9, abs(f.y - 0.5) * 2.0);
            else if (h < 0.12) tr = 1.0 - smoothstep(0.0, fwidth(p.x) * 0.9, abs(f.x - 0.5) * 2.0);
            float flow = 0.5 + 0.5 * sin((p.x + p.y) * 0.8 - uTime * 1.5 * uLife + h * 20.0);
            col += uDot * tr * (0.08 + 0.1 * flow * uLife) * focus;

            // runtime core pool
            float cd = length(p - uCore);
            col += uGo * exp(-cd * cd / 6.0) * 0.10 * (0.4 + 0.6 * uLife);
            col += uGo * exp(-pow((cd - 2.6) * 6.0, 2.0)) * 0.06 * uLife;

            // event ripples
            for (int i = 0; i < ${RIPPLES}; i++) {
              vec4 rp = uRipples[i];
              float age = uTime - rp.z;
              if (age < 0.0 || age > 2.5) continue;
              float rad = age * 2.6;
              float dd = length(p - rp.xy);
              float ring = exp(-pow((dd - rad) * 5.5, 2.0));
              float fade = (1.0 - age / 2.5);
              col += uRippleColors[i] * ring * fade * fade * rp.w * 0.22 * (0.35 + d * 2.5);
            }

            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
            #include <fog_fragment>
          }
        `,
      }),
    [],
  )

  useFrame(() => {
    const u = material.uniforms
    u.uTime.value = session.clock
    u.uLife.value = session.fx.life
    for (let i = 0; i < RIPPLES; i++) {
      const r = ripples[i]
      const slot = u.uRipples.value[i] as Vector4
      if (r) {
        slot.set(r.x, r.z, r.t0, r.strength)
        ;(u.uRippleColors.value[i] as Color).copy(r.color)
      } else slot.set(0, 0, -100, 0)
    }
  })

  return (
    <mesh rotation-x={-Math.PI / 2} material={material} renderOrder={-2}>
      <planeGeometry args={[120, 120]} />
    </mesh>
  )
}
