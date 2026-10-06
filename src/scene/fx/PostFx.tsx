import { useFrame } from '@react-three/fiber'
import {
  Bloom,
  BrightnessContrast,
  ChromaticAberration,
  EffectComposer,
  HueSaturation,
  Noise,
  Vignette,
} from '@react-three/postprocessing'
import { BlendFunction, type BrightnessContrastEffect, type ChromaticAberrationEffect, type HueSaturationEffect } from 'postprocessing'
import { useRef } from 'react'
import { Vector2 } from 'three'
import { session } from '../../simulation/session'

/** Restrained grade: bloom for emissives, a breath of grain, and dials the FX director can turn. */
export function PostFx() {
  const ca = useRef<ChromaticAberrationEffect>(null)
  const hs = useRef<HueSaturationEffect>(null)
  const bc = useRef<BrightnessContrastEffect>(null)
  const offset = useRef(new Vector2(0.0004, 0.0004))

  useFrame(() => {
    const fx = session.fx
    const g = fx.glitch
    if (ca.current) {
      const jitter = g > 0.01 ? (Math.random() - 0.5) * g * 0.02 : 0
      ca.current.offset.set(0.00035 + g * 0.006 + jitter, 0.00035 + g * 0.002 - jitter * 0.5)
    }
    if (hs.current) hs.current.saturation = -fx.desaturate
    if (bc.current) bc.current.brightness = -fx.dim * 0.35
  })

  return (
    <EffectComposer multisampling={0}>
      <Bloom intensity={1.05} luminanceThreshold={0.62} luminanceSmoothing={0.2} mipmapBlur radius={0.72} />
      <ChromaticAberration ref={ca} offset={offset.current} radialModulation modulationOffset={0.25} />
      <HueSaturation ref={hs} saturation={0} />
      <BrightnessContrast ref={bc} brightness={0} contrast={0.04} />
      <Noise premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.22} />
      <Vignette offset={0.22} darkness={0.78} />
    </EffectComposer>
  )
}
