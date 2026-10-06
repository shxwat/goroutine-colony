import { AdditiveBlending, Color, ShaderMaterial, UniformsLib, UniformsUtils } from 'three'

/**
 * Dark carapace with a coloured fresnel rim. Used for creature bodies and
 * structures. No scene lights required: lighting is baked into the shader so
 * the whole world shares one consistent, moody key light.
 *
 * On an InstancedMesh with instanceColor, the rim takes the instance colour;
 * otherwise it uses uTint.
 */
export function makeShellMaterial(opts: { base?: string; tint?: string; rim?: number; spec?: number } = {}) {
  return new ShaderMaterial({
    fog: true,
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      {
        uBase: { value: new Color(opts.base ?? '#0b1117') },
        uTint: { value: new Color(opts.tint ?? '#00add8') },
        uRim: { value: opts.rim ?? 1.6 },
        uSpec: { value: opts.spec ?? 0.5 },
        uOpacity: { value: 1 },
      },
    ]),
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      varying vec3 vN;
      varying vec3 vW;
      varying vec3 vTint;
      uniform vec3 uTint;
      void main() {
        mat4 m = modelMatrix;
        #ifdef USE_INSTANCING
          m = m * instanceMatrix;
        #endif
        vec4 world = m * vec4(position, 1.0);
        vW = world.xyz;
        vN = normalize(mat3(m) * normal);
        #ifdef USE_INSTANCING_COLOR
          vTint = instanceColor;
        #else
          vTint = uTint;
        #endif
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform vec3 uBase;
      uniform float uRim;
      uniform float uSpec;
      uniform float uOpacity;
      varying vec3 vN;
      varying vec3 vW;
      varying vec3 vTint;
      void main() {
        vec3 n = normalize(vN);
        vec3 v = normalize(cameraPosition - vW);
        vec3 L = normalize(vec3(-0.35, 1.0, 0.45));
        float ndl = clamp(dot(n, L), 0.0, 1.0);
        float fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 2.4);
        vec3 col = uBase * (0.45 + ndl * 1.6);
        vec3 h = normalize(L + v);
        col += vec3(0.62, 0.78, 0.9) * pow(max(dot(n, h), 0.0), 90.0) * uSpec;
        col += vTint * fres * uRim;
        col += vTint * clamp(-n.y, 0.0, 1.0) * 0.06;
        gl_FragColor = vec4(col, uOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  })
}

/** Soft radial blob for additive light pools on the floor. */
export function makePoolMaterial() {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {},
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vColor;
      void main() {
        vUv = uv;
        #ifdef USE_INSTANCING_COLOR
          vColor = instanceColor;
        #else
          vColor = vec3(1.0);
        #endif
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vColor;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float a = exp(-d * d * 4.5) * (1.0 - smoothstep(0.85, 1.0, d));
        gl_FragColor = vec4(vColor * a, 1.0);
      }
    `,
  })
}
