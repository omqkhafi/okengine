/**
 * Hero backdrop — the React Bits `Prism` WebGL background (MIT, see site/NOTICE)
 * adapted for okengine: fixed okengine tuning instead of a prop surface, the
 * live `dark` class instead of a `lightMode` flag, and the reduced-motion
 * contract (time frozen, one frame painted, no rAF loop).
 */

"use client";

import { Mesh, Program, Renderer, Triangle } from "ogl";
import { useEffect, useRef, useState } from "react";
import { useClientReducedMotion } from "@/lib/use-client-reduced-motion";

/** Prism geometry and grade — quiet enough to sit behind hero copy. */
const HEIGHT = 3.6;
const BASE_WIDTH = 5.6;
const SCALE = 2.9;
const GLOW = 0.85;
const NOISE = 0.12;
/**
 * Near-grey on purpose: the prism's own rainbow is flattened so the element
 * tint is the only colour in the glow. The YIQ hue matrix is not
 * hue-preserving on grey ink, so hue shifting is left at zero.
 */
const SATURATION = 0.1;
const HUE_SHIFT = 0;
/** How much of the tint reaches the glow. */
const TINT_AMOUNT = 1;
/**
 * Deepens the tint's off-peak channels. The element inks are pale by design,
 * and a peak-normalised pale colour reads as white once the glow clips.
 */
const TINT_GAMMA = 1.9;
/** Per-frame approach rate of the tint, so a beat change fades rather than cuts. */
const TINT_EASE = 0.045;
const COLOR_FREQ = 1.1;
const BLOOM = 1.15;
const TIME_SCALE = 0.2;

const VERTEX = /* glsl */ `
  attribute vec2 position;
  void main() {
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  precision highp float;

  uniform vec2  iResolution;
  uniform float iTime;
  uniform float uGlow;
  uniform float uNoise;
  uniform float uSaturation;
  uniform float uHueShift;
  uniform float uColorFreq;
  uniform float uBloom;
  uniform float uCenterShift;
  uniform float uInvBaseHalf;
  uniform float uInvHeight;
  uniform float uMinAxis;
  uniform float uPxScale;
  uniform float uTimeScale;
  uniform float uLightMode;
  uniform vec3  uTint;
  uniform float uTintAmount;

  vec4 tanh4(vec4 x){
    vec4 e2x = exp(2.0 * x);
    return (e2x - 1.0) / (e2x + 1.0);
  }

  float rand(vec2 co){
    return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  float sdOctaAnisoInv(vec3 p){
    vec3 q = vec3(abs(p.x) * uInvBaseHalf, abs(p.y) * uInvHeight, abs(p.z) * uInvBaseHalf);
    float m = q.x + q.y + q.z - 1.0;
    return m * uMinAxis * 0.5773502691896258;
  }

  float sdPyramidUpInv(vec3 p){
    return max(sdOctaAnisoInv(p), -p.y);
  }

  mat3 hueRotation(float a){
    float c = cos(a), s = sin(a);
    mat3 W = mat3(0.299, 0.587, 0.114, 0.299, 0.587, 0.114, 0.299, 0.587, 0.114);
    mat3 U = mat3(0.701, -0.587, -0.114, -0.299, 0.413, -0.114, -0.300, -0.588, 0.886);
    mat3 V = mat3(0.168, -0.331, 0.500, 0.328, 0.035, -0.500, -0.497, 0.296, 0.201);
    return W + U * c + V * s;
  }

  void main(){
    vec2 f = (gl_FragCoord.xy - 0.5 * iResolution.xy) * uPxScale;

    float z = 5.0;
    float d = 0.0;
    vec3 p;
    vec4 o = vec4(0.0);

    float t = iTime * uTimeScale;
    mat2 wob = mat2(cos(t), cos(t + 33.0), cos(t + 11.0), cos(t));

    const int STEPS = 100;
    for (int i = 0; i < STEPS; i++) {
      p = vec3(f, z);
      p.xz = p.xz * wob;
      vec3 q = p;
      q.y += uCenterShift;
      d = 0.1 + 0.2 * abs(sdPyramidUpInv(q));
      z -= d;
      o += (sin((p.y + z) * uColorFreq + vec4(0.0, 1.0, 2.0, 3.0)) + 1.0) / d;
    }

    o = tanh4(o * o * (uGlow * uBloom) / 1e5);

    vec3 col = o.rgb;
    col += (rand(gl_FragCoord.xy + vec2(iTime)) - 0.5) * uNoise;
    col = clamp(col, 0.0, 1.0);

    float L = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = clamp(mix(vec3(L), col, uSaturation), 0.0, 1.0);

    if (abs(uHueShift) > 0.0001) {
      col = clamp(hueRotation(uHueShift) * col, 0.0, 1.0);
    }

    col = clamp(col * mix(vec3(1.0), uTint, uTintAmount), 0.0, 1.0);

    if (uLightMode > 0.5) {
      float peak = max(col.r, max(col.g, col.b));
      vec3 chroma = pow(clamp(col / max(peak, 0.0001), 0.0, 1.0), vec3(1.14));
      gl_FragColor = vec4(mix(vec3(1.0), chroma, o.a * 0.94), o.a);
    } else {
      gl_FragColor = vec4(col, o.a);
    }
  }
`;

/**
 * Resolve any CSS colour — including `var(--oke-el-*)`, which Chrome computes
 * as `lab(…)` — to a normalised sRGB triple. A 1×1 canvas does the conversion,
 * so every colour syntax the browser can parse works; normalising by the peak
 * channel keeps the glow's brightness and lets the hue do the talking.
 *
 * @param color - CSS colour value, or a `var(--…)` reference
 */
function resolveTint(color: string): [number, number, number] {
  const probe = document.createElement("span");
  probe.style.color = color;
  probe.style.display = "none";
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();

  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d");
  if (!context) return [1, 1, 1];
  context.fillStyle = computed;
  context.fillRect(0, 0, 1, 1);
  const [r = 255, g = 255, b = 255] = context.getImageData(0, 0, 1, 1).data;
  const peak = Math.max(r, g, b, 1);
  return [(r / peak) ** TINT_GAMMA, (g / peak) ** TINT_GAMMA, (b / peak) ** TINT_GAMMA];
}

/**
 * Live dark-mode reading. `resolvedTheme` is unset until next-themes hydrates,
 * so the shader follows the `dark` class the provider actually paints.
 */
function useDarkClass(): boolean {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setDark(root.classList.contains("dark"));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return dark;
}

/**
 * Full-bleed prism glow for the hero section. Decorative only: no pointer
 * target, masked away from the copy, and frozen on one frame under
 * `prefers-reduced-motion`.
 */
export function PrismBackdrop({ tone }: { readonly tone?: string } = {}) {
  const reduced = useClientReducedMotion();
  const dark = useDarkClass();
  const hostRef = useRef<HTMLDivElement>(null);
  const toneRef = useRef(tone);
  const repaintRef = useRef<(() => void) | null>(null);

  // The render loop reads the tone off the ref; reduced motion paints one
  // frame, so a beat change there needs an explicit repaint.
  useEffect(() => {
    toneRef.current = tone;
    repaintRef.current?.();
  }, [tone]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const baseHalf = BASE_WIDTH * 0.5;
    // A blurred glow buys nothing from retina pixels, and the march is 100
    // steps per fragment — half the pixels, half the GPU, same picture.
    const dpr = Math.min(1.25, window.devicePixelRatio || 1);
    const renderer = new Renderer({ dpr, alpha: true, antialias: false });
    const gl = renderer.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);

    Object.assign(gl.canvas.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      display: "block",
    } satisfies Partial<CSSStyleDeclaration>);
    host.appendChild(gl.canvas);

    const resolution = new Float32Array(2);
    const tint = new Float32Array(resolveTint(toneRef.current ?? "#ffffff"));
    const program = new Program(gl, {
      vertex: VERTEX,
      fragment: FRAGMENT,
      uniforms: {
        iResolution: { value: resolution },
        iTime: { value: 0 },
        uGlow: { value: GLOW },
        uNoise: { value: NOISE },
        uSaturation: { value: SATURATION },
        uHueShift: { value: HUE_SHIFT },
        uColorFreq: { value: COLOR_FREQ },
        uBloom: { value: BLOOM },
        uCenterShift: { value: HEIGHT * 0.25 },
        uInvBaseHalf: { value: 1 / baseHalf },
        uInvHeight: { value: 1 / HEIGHT },
        uMinAxis: { value: Math.min(baseHalf, HEIGHT) },
        uPxScale: { value: 1 / ((gl.drawingBufferHeight || 1) * 0.1 * SCALE) },
        uTimeScale: { value: reduced ? 0 : TIME_SCALE },
        uLightMode: { value: dark ? 0 : 1 },
        uTint: { value: tint },
        uTintAmount: { value: toneRef.current ? TINT_AMOUNT : 0 },
      },
    });
    const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });

    const resize = () => {
      const width = host.clientWidth || 1;
      const height = host.clientHeight || 1;
      if (width === renderer.width && height === renderer.height) return;
      renderer.setSize(width, height);
      // The canvas is stretched by CSS; ogl pins it in px, which fights the mask.
      Object.assign(gl.canvas.style, { width: "100%", height: "100%" });
      resolution[0] = gl.drawingBufferWidth;
      resolution[1] = gl.drawingBufferHeight;
      program.uniforms.uPxScale.value = 1 / ((gl.drawingBufferHeight || 1) * 0.1 * SCALE);
    };
    const observer = new ResizeObserver(() => {
      resize();
      // Reduced motion paints one frame, so a late layout needs a repaint.
      if (reduced) renderer.render({ scene: mesh });
    });
    observer.observe(host);
    resize();

    let frame = 0;
    let tick = 0;
    let toneKey = toneRef.current;
    let target = Array.from(tint) as [number, number, number];
    const start = performance.now();
    const render = (now: number) => {
      // The host is percentage-sized, so its first measurement can land before
      // the hero has a height; re-check periodically instead of trusting one RO.
      if (tick++ % 20 === 0) resize();

      if (toneRef.current !== toneKey) {
        toneKey = toneRef.current;
        target = resolveTint(toneKey ?? "#ffffff");
      }
      const ease = reduced ? 1 : TINT_EASE;
      for (let channel = 0; channel < 3; channel++) {
        tint[channel] += (target[channel]! - tint[channel]!) * ease;
      }

      program.uniforms.iTime.value = (now - start) * 0.001;
      renderer.render({ scene: mesh });
      frame = reduced ? 0 : requestAnimationFrame(render);
    };
    repaintRef.current = () => {
      if (reduced) render(performance.now());
    };

    // Offscreen hero: stop the loop rather than burn a GPU on an unseen glow.
    const visibility = new IntersectionObserver((entries) => {
      const visible = entries.some((entry) => entry.isIntersecting);
      if (visible && !frame && !reduced) {
        frame = requestAnimationFrame(render);
        return;
      }
      if (!visible && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    });
    visibility.observe(host);
    render(performance.now());

    return () => {
      if (frame) cancelAnimationFrame(frame);
      repaintRef.current = null;
      visibility.disconnect();
      observer.disconnect();
      if (gl.canvas.parentElement === host) host.removeChild(gl.canvas);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [reduced, dark]);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden select-none">
      <div
        ref={hostRef}
        className="absolute inset-x-0 -top-[10%] h-[115%] opacity-35 [mask-image:radial-gradient(82%_70%_at_50%_22%,#000_0%,#000_42%,transparent_88%)] dark:opacity-65"
      />
    </div>
  );
}
