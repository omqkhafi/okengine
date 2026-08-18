/**
 * Three.js isometric keycap field — eight caps on a true isometric grid.
 *
 * The homepage imports this only after mount so `three` stays out of the
 * server graph. One cap per element: a matte, grainy lid carrying a two-letter
 * mark, a wall that reads darker than the lid, and — when the seat is lit — a
 * streaked emissive wall, an additive spill skirt, a ground pool, and dashed
 * drop-lines marking the rise.
 *
 * Material notes, because they are the whole point:
 *  - Lighting is a procedural equirect environment (PMREM), not raw lights. A
 *    soft overhead box lights the lids and a faint camera-side rim separates a
 *    near-black cap from a near-black page.
 *  - One shared grain tile drives lid albedo, roughness, and bump at the same
 *    UV scale, so the speckle reads as surface rather than as a decal.
 *  - Lid UVs are reprojected planar from above, which is what lets a single
 *    canvas paint tint, grain, and the mark with no seam at the bevel.
 *  - Extruded geometry is non-indexed and therefore flat-shaded by default;
 *    `smoothNormals` is what keeps the round-overs from faceting.
 *  - Lit state is one eased scalar per cap. Nothing is rebuilt on hover.
 */

import * as THREE from "three";

/** One seat's paint data — the mark sits on the cap lid. */
export type IsoTileSpec = {
  readonly symbol: string;
  /** Element preview kind — resolves the `--oke-el-*` ink. */
  readonly preview: string;
};

/** Callbacks the React host uses to keep the caption and routing in sync. */
export type IsoLatticeHost = {
  readonly canvas: HTMLCanvasElement;
  readonly tiles: readonly IsoTileSpec[];
  readonly reduced: boolean;
  readonly onHover: (index: number | null) => void;
  readonly onSelect: (index: number, event: MouseEvent) => void;
};

/** Imperative handle — the React tree drives `setLit`; the scene owns the GL. */
export type IsoLatticeHandle = {
  setLit: (index: number | null) => void;
  dispose: () => void;
};

const COLS = 4;
const ROWS = 2;

const SIZE = 1;
/** Sharp corners — just enough radius to keep the silhouette from aliasing. */
const RADIUS = 0.045;
const LID_H = 0.17;
const WALL_H = 0.125;
const CAP_H = LID_H + WALL_H;
/** The lid overhangs the wall by a hair — the reference cap's tell. */
const WALL_INSET = 0.975;
/** Hairline round-over: the edge still needs to catch the environment. */
const BEVEL = 0.014;
const GAP = 0.19;
const STRIDE = SIZE + GAP;
const LIFT = 0.46;

/** Breathing room around the caps, in world units. */
const PAD = 0.14;
/**
 * Extra room below. The contact shadow and the lit pool spread across the floor
 * well past a cap's footprint, and on screen that spread lands under the front
 * row — so the framing box, which only knows about the caps, runs short there.
 */
const PAD_FLOOR = 0.4;

/** Grain tiles per cap — matched between the lid canvas and the roughness map. */
const GRAIN_REPEAT = 2;
/** Striation repeats around the wall perimeter. */
const STREAK_REPEAT = 3;

/** True isometric: 45° azimuth, `atan(1/√2)` elevation — 30° edges on screen. */
const CAMERA_DIR = new THREE.Vector3(1, 1, 1).normalize();

const MONO_FALLBACK = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

/** 1×1 scratch canvas used to resolve CSS colors the GPU never sees. */
const PROBE = document.createElement("canvas");
PROBE.width = 1;
PROBE.height = 1;
const PROBE_CTX = PROBE.getContext("2d", { willReadFrequently: true });

/**
 * Resolve a CSS color (oklch / lab / hex) to a Three color via a 1×1 canvas.
 * `THREE.Color` cannot parse `lab()`, which is what `getComputedStyle` returns
 * for the Fumadocs tokens in Chromium.
 *
 * @param css - Any value canvas `fillStyle` accepts
 */
function cssToColor(css: string): THREE.Color {
  if (!PROBE_CTX) return new THREE.Color("#888888");
  PROBE_CTX.fillStyle = "#000000";
  PROBE_CTX.fillStyle = css;
  PROBE_CTX.fillRect(0, 0, 1, 1);
  const pixel = PROBE_CTX.getImageData(0, 0, 1, 1).data;
  return new THREE.Color(
    (pixel[0] ?? 0) / 255,
    (pixel[1] ?? 0) / 255,
    (pixel[2] ?? 0) / 255,
  ).convertSRGBToLinear();
}

/**
 * The cap itself — one recipe, both themes. A keycap is an object, not a
 * surface of the page, so flipping the theme must not restyle it; only what it
 * casts onto the page below is allowed to follow the theme.
 */
const SURFACE = {
  /** Lid base tint, as a CSS string: it is drawn into a canvas, not uploaded. */
  lid: "#23252d",
  /** Mark ink, as a CSS string. */
  ink: "#8d93a2",
  grainAlpha: 0.5,
  wall: new THREE.Color("#12131a"),
  lidRoughness: 0.85,
  clearcoat: 0.35,
  envIntensity: 1.2,
  skirt: 0.55,
  pool: 0.4,
  wallEmissive: 2.6,
  markEmissive: 1.6,
  key: 0.55,
  rim: 0.5,
  exposure: 1,
} as const;

/** Surface recipe plus the theme-dependent marks it leaves on the page. */
type Palette = typeof SURFACE & {
  readonly contact: number;
  readonly shadow: number;
  readonly drop: THREE.Color;
  readonly dropOpacity: number;
  readonly tones: readonly THREE.Color[];
};

/**
 * Read theme inks off `:root` so a theme flip repaints without a remount.
 * Element inks stay theme-aware because the caption beside the canvas resolves
 * the same `--oke-el-*` token; a lit wall and its label have to agree.
 *
 * @param tiles - Seats, in field order — supplies each `--oke-el-*` name
 */
function readPalette(tiles: readonly IsoTileSpec[]): Palette {
  const root = document.documentElement;
  const css = getComputedStyle(root);
  const dark = root.classList.contains("dark");
  const fallback = dark ? "#fafafa" : "#18181b";
  const tones = tiles.map((tile) => {
    const value = css.getPropertyValue(`--oke-el-${tile.preview}`).trim();
    return cssToColor(value.length > 0 ? value : fallback);
  });

  // Dark caps sit on a bright page in light mode, so the contact pool and the
  // drop-lines invert while the cap does not.
  return {
    ...SURFACE,
    contact: dark ? 0.5 : 0.34,
    shadow: dark ? 0.26 : 0.22,
    drop: new THREE.Color(dark ? "#93a3b8" : "#5c636f"),
    dropOpacity: 0.32,
    tones,
  };
}

/**
 * Fine value noise — one shared tile driving lid albedo speckle, roughness
 * variation, and micro-bump at a single UV scale.
 */
function grainTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  if (!ctx) return texture;

  const raw = new Float32Array(size * size);
  for (let i = 0; i < raw.length; i += 1) raw[i] = Math.random();

  // One wrapped box pass widens the speckle to roughly two texels, which is
  // what survives mipmapping at the on-screen size of a cap. Re-expanding the
  // deviation afterwards buys the contrast the blur just cost.
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          sum += raw[((y + dy + size) % size) * size + ((x + dx + size) % size)] ?? 0.5;
        }
      }
      const spread = Math.max(0, Math.min(1, 0.5 + (sum / 9 - 0.5) * 2.4));
      const byte = Math.round(88 + spread * 97);
      const at = (y * size + x) * 4;
      image.data[at] = byte;
      image.data[at + 1] = byte;
      image.data[at + 2] = byte;
      image.data[at + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(GRAIN_REPEAT, GRAIN_REPEAT);
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Draw a cap mark centred on a square canvas. Planar lid UVs put canvas +x on
 * world +x and canvas down on world +z, which is the orientation a surface
 * viewed from above has, so the mark is drawn upright: the isometric camera
 * shears it to read down-screen along the column axis on its own.
 *
 * @param ctx - Target context, sized `size` × `size`
 * @param symbol - Two-letter element shorthand
 * @param size - Canvas edge
 * @param ink - CSS fill for the glyphs
 * @param font - Resolved CSS font family
 */
function drawMark(
  ctx: CanvasRenderingContext2D,
  symbol: string,
  size: number,
  ink: string,
  font: string,
): void {
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.fillStyle = ink;
  ctx.font = `600 ${Math.round(size * 0.3)}px ${font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(symbol, 0, size * 0.008);
  ctx.restore();
}

/**
 * Lid albedo — base tint, the shared grain at the lid's UV scale, and the mark.
 *
 * @param symbol - Two-letter element shorthand
 * @param palette - Active theme recipe
 * @param grain - Shared grain canvas, tiled to match the roughness map
 * @param font - Resolved CSS font family for the mark
 */
function lidTexture(
  symbol: string,
  palette: Palette,
  grain: HTMLCanvasElement,
  font: string,
): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  if (!ctx) return texture;

  ctx.fillStyle = palette.lid;
  ctx.fillRect(0, 0, size, size);

  const tile = size / GRAIN_REPEAT;
  ctx.globalAlpha = palette.grainAlpha;
  ctx.globalCompositeOperation = "overlay";
  for (let y = 0; y < GRAIN_REPEAT; y += 1) {
    for (let x = 0; x < GRAIN_REPEAT; x += 1) {
      ctx.drawImage(grain, x * tile, y * tile, tile, tile);
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  drawMark(ctx, symbol, size, palette.ink, font);

  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Mark-only mask — drives lid emissive so a lit cap's letters glow without
 * washing the whole lid in the element ink.
 *
 * @param symbol - Two-letter element shorthand
 * @param font - Resolved CSS font family for the mark
 */
function markTexture(symbol: string, font: string): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  if (!ctx) return texture;

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, size, size);
  drawMark(ctx, symbol, size, "#ffffff", font);

  texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Wall emissive — vertical striations that peak just under the lid edge and
 * fade toward the floor, which is how a backlit keycap actually reads.
 */
function streakTexture(): THREE.CanvasTexture {
  const w = 512;
  const h = 64;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  if (!ctx) return texture;

  // Two octaves of smoothed 1-D noise give striations of mixed width without
  // the tell-tale regularity of a sine.
  const octave = (count: number): ((u: number) => number) => {
    const seeds = Array.from({ length: count }, () => Math.random());
    return (u: number) => {
      const t = u * count;
      const i = Math.floor(t) % count;
      const f = t - Math.floor(t);
      const s = f * f * (3 - 2 * f);
      return (seeds[i] ?? 0.5) * (1 - s) + (seeds[(i + 1) % count] ?? 0.5) * s;
    };
  };
  const coarse = octave(24);
  const fine = octave(88);

  const image = ctx.createImageData(w, h);
  for (let x = 0; x < w; x += 1) {
    const streak = 0.5 + 0.34 * coarse(x / w) + 0.22 * fine(x / w);
    for (let y = 0; y < h; y += 1) {
      const v = 1 - y / (h - 1);
      const body = 0.1 + 0.9 * v ** 1.7;
      const crest = Math.exp(-(((v - 0.93) / 0.09) ** 2)) * 0.55;
      const byte = Math.round(Math.max(0, Math.min(1, (body + crest) * streak)) * 255);
      const at = (y * w + x) * 4;
      image.data[at] = byte;
      image.data[at + 1] = byte;
      image.data[at + 2] = byte;
      image.data[at + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Spill skirt alpha — soft vertical falloff peaking at the wall band, bleeding
 * a little onto the lid bevel above and the floor below.
 */
function skirtTexture(): THREE.CanvasTexture {
  const w = 4;
  const h = 128;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  if (!ctx) return texture;

  const image = ctx.createImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    const v = 1 - y / (h - 1);
    const byte = Math.round(Math.exp(-(((v - 0.46) / 0.24) ** 2)) * 255);
    for (let x = 0; x < w; x += 1) {
      const at = (y * w + x) * 4;
      image.data[at] = 255;
      image.data[at + 1] = 255;
      image.data[at + 2] = 255;
      image.data[at + 3] = byte;
    }
  }
  ctx.putImageData(image, 0, 0);

  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Radial alpha disc — the contact darkening under every cap and the tone pool
 * under a lit one. Alpha carries the falloff, so the same map serves both a
 * dark decal and an additive light one.
 *
 * @param core - Fraction of the radius that stays fully opaque
 */
function discTexture(core: number): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  if (!ctx) return texture;

  const gradient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    (size / 2) * core,
    size / 2,
    size / 2,
    size / 2,
  );
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.55, "rgba(255,255,255,0.42)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Procedural equirect environment. A soft overhead box lights the lids, a
 * dimmer camera-side box puts a faint rim on the near walls, and a floor band
 * keeps the undersides from going flat.
 *
 * The studio is theme-independent for the same reason `SURFACE` is: it is the
 * room the cap is photographed in, not part of the page.
 */
function environmentTexture(): THREE.CanvasTexture {
  const w = 512;
  const h = 256;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  if (!ctx) return texture;

  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#4a5262");
  sky.addColorStop(0.36, "#1c2129");
  sky.addColorStop(0.52, "#0a0c11");
  sky.addColorStop(1, "#040507");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  const box = (cx: number, cy: number, rx: number, ry: number, color: string): void => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(rx, ry);
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    glow.addColorStop(0, color);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  };

  ctx.filter = "blur(6px)";
  box(w * 0.18, h * 0.14, w * 0.3, h * 0.24, "rgba(255,255,255,0.9)");
  box(w * 0.68, h * 0.3, w * 0.22, h * 0.18, "rgba(150,175,215,0.42)");
  box(w * 0.42, h * 0.78, w * 0.4, h * 0.2, "rgba(70,90,120,0.22)");
  ctx.filter = "none";

  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Average normals across coincident vertices. `ExtrudeGeometry` is non-indexed,
 * so its own `computeVertexNormals` is flat-shaded — every bevel and corner
 * facets. Welding only the normals keeps per-vertex UVs intact.
 *
 * @param geo - Non-indexed geometry with position and normal attributes
 */
function smoothNormals(geo: THREE.BufferGeometry): void {
  const position = geo.attributes.position;
  const normal = geo.attributes.normal;
  if (!position || !normal) return;

  const buckets = new Map<string, { x: number; y: number; z: number; hits: number[] }>();
  for (let i = 0; i < position.count; i += 1) {
    const key = `${position.getX(i).toFixed(4)}|${position.getY(i).toFixed(4)}|${position
      .getZ(i)
      .toFixed(4)}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.x += normal.getX(i);
      bucket.y += normal.getY(i);
      bucket.z += normal.getZ(i);
      bucket.hits.push(i);
      continue;
    }
    buckets.set(key, {
      x: normal.getX(i),
      y: normal.getY(i),
      z: normal.getZ(i),
      hits: [i],
    });
  }

  for (const bucket of buckets.values()) {
    const len = Math.hypot(bucket.x, bucket.y, bucket.z) || 1;
    for (const i of bucket.hits) {
      normal.setXYZ(i, bucket.x / len, bucket.y / len, bucket.z / len);
    }
  }
  normal.needsUpdate = true;
}

/** A closed rounded-square loop in XZ, plus its cumulative arclength. */
type Loop = {
  readonly x: readonly number[];
  readonly z: readonly number[];
  readonly cum: readonly number[];
  readonly total: number;
};

/**
 * Rounded-square loop, wound counter-clockwise from the far corner so the
 * striation seam lands on a face the isometric camera never sees.
 *
 * @param size - Footprint width
 * @param radius - Corner radius
 * @param arcSteps - Subdivisions per corner
 */
function roundedLoop(size: number, radius: number, arcSteps: number): Loop {
  const half = size / 2;
  const r = Math.max(0.001, Math.min(radius, half - 0.001));
  const x: number[] = [];
  const z: number[] = [];
  const push = (px: number, pz: number): void => {
    x.push(px);
    z.push(pz);
  };
  const arc = (cx: number, cz: number, from: number, to: number, closing: boolean): void => {
    const steps = closing ? arcSteps - 1 : arcSteps;
    for (let i = 1; i <= steps; i += 1) {
      const a = from + ((to - from) * i) / arcSteps;
      push(cx + Math.cos(a) * r, cz + Math.sin(a) * r);
    }
  };

  push(-half + r, -half);
  push(half - r, -half);
  arc(half - r, -half + r, -Math.PI / 2, 0, false);
  push(half, half - r);
  arc(half - r, half - r, 0, Math.PI / 2, false);
  push(-half + r, half);
  arc(-half + r, half - r, Math.PI / 2, Math.PI, false);
  push(-half, -half + r);
  arc(-half + r, -half + r, Math.PI, Math.PI * 1.5, true);

  const cum: number[] = [0];
  for (let i = 0; i < x.length; i += 1) {
    const j = (i + 1) % x.length;
    cum.push((cum[i] ?? 0) + Math.hypot((x[j] ?? 0) - (x[i] ?? 0), (z[j] ?? 0) - (z[i] ?? 0)));
  }
  return { x, z, cum, total: cum[x.length] ?? 1 };
}

/**
 * Vertical wall around a loop. `u` is exact arclength so striations stay evenly
 * spaced through the corners, and adjacent face normals are averaged so the
 * corners read rounded under the environment.
 *
 * @param loop - Footprint loop
 * @param height - Wall height
 * @param repeat - Striation repeats around the perimeter
 */
function wallGeometry(loop: Loop, height: number, repeat: number): THREE.BufferGeometry {
  const n = loop.x.length;
  const faces: Array<readonly [number, number]> = [];
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const dx = (loop.x[j] ?? 0) - (loop.x[i] ?? 0);
    const dz = (loop.z[j] ?? 0) - (loop.z[i] ?? 0);
    const len = Math.hypot(dx, dz) || 1;
    faces.push([dz / len, -dx / len]);
  }

  const columns = n + 1;
  const position = new Float32Array(columns * 2 * 3);
  const normal = new Float32Array(columns * 2 * 3);
  const uv = new Float32Array(columns * 2 * 2);

  for (let c = 0; c < columns; c += 1) {
    const i = c % n;
    const prev = faces[(i - 1 + n) % n] ?? [0, 0];
    const here = faces[i] ?? [0, 0];
    const nx = prev[0] + here[0];
    const nz = prev[1] + here[1];
    const len = Math.hypot(nx, nz) || 1;
    const u = ((loop.cum[c] ?? 0) / loop.total) * repeat;
    for (let row = 0; row < 2; row += 1) {
      const at = (c * 2 + row) * 3;
      position[at] = loop.x[i] ?? 0;
      position[at + 1] = row * height;
      position[at + 2] = loop.z[i] ?? 0;
      normal[at] = nx / len;
      normal[at + 1] = 0;
      normal[at + 2] = nz / len;
      const uvAt = (c * 2 + row) * 2;
      uv[uvAt] = u;
      uv[uvAt + 1] = row;
    }
  }

  const index: number[] = [];
  for (let c = 0; c < n; c += 1) {
    const a = c * 2;
    index.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(index);
  return geo;
}

/**
 * Rounded slab standing on +Y, rounded over top and bottom, with UVs
 * reprojected planar from above so one canvas paints lid and bevel seamlessly.
 * `v` runs against +Z: looking down at an up-facing face puts world -Z at the
 * top of the image, and getting that backwards mirrors the mark.
 *
 * @param size - Footprint width including the round-over
 * @param radius - Corner radius
 * @param height - Total height
 * @param bevel - Edge round-over
 */
function lidGeometry(
  size: number,
  radius: number,
  height: number,
  bevel: number,
): THREE.ExtrudeGeometry {
  const half = size / 2 - bevel;
  const r = Math.max(0.01, Math.min(radius - bevel, half - 0.01));
  const shape = new THREE.Shape();
  shape.moveTo(-half + r, -half);
  shape.lineTo(half - r, -half);
  shape.absarc(half - r, -half + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(half, half - r);
  shape.absarc(half - r, half - r, r, 0, Math.PI / 2, false);
  shape.lineTo(-half + r, half);
  shape.absarc(-half + r, half - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(-half, -half + r);
  shape.absarc(-half + r, -half + r, r, Math.PI, Math.PI * 1.5, false);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, height - bevel * 2),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: 0,
    bevelSegments: 3,
    curveSegments: 8,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, bevel, 0);
  geo.computeBoundingBox();

  const box = geo.boundingBox;
  const uv = geo.attributes.uv;
  const position = geo.attributes.position;
  if (box && uv) {
    const spanX = box.max.x - box.min.x || 1;
    const spanZ = box.max.z - box.min.z || 1;
    for (let i = 0; i < uv.count; i += 1) {
      uv.setXY(
        i,
        (position.getX(i) - box.min.x) / spanX,
        1 - (position.getZ(i) - box.min.z) / spanZ,
      );
    }
    uv.needsUpdate = true;
  }
  smoothNormals(geo);
  return geo;
}

/**
 * World XZ of a seat — back row is Flow–Clock, front row Gate–AI.
 *
 * @param index - Field order
 */
function seatXZ(index: number): { readonly x: number; readonly z: number } {
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  return {
    x: col * STRIDE - ((COLS - 1) * STRIDE) / 2,
    z: row * STRIDE - ((ROWS - 1) * STRIDE) / 2,
  };
}

/** Everything one seat owns. `lift` and `appear` are the only mutable state. */
type CapRig = {
  readonly cap: THREE.Group;
  readonly pick: THREE.Mesh;
  readonly lidMat: THREE.MeshPhysicalMaterial;
  readonly wallMat: THREE.MeshStandardMaterial;
  readonly skirtMat: THREE.MeshBasicMaterial;
  readonly poolMat: THREE.MeshBasicMaterial;
  readonly contactMat: THREE.MeshBasicMaterial;
  readonly pool: THREE.Mesh;
  readonly contact: THREE.Mesh;
  readonly drops: readonly THREE.Line[];
  readonly dropMats: readonly THREE.LineDashedMaterial[];
  readonly tone: THREE.Color;
  readonly wallBase: THREE.Color;
  readonly delay: number;
  lift: number;
  appear: number;
};

/**
 * Mount the isometric field onto an existing canvas. Caller disposes.
 *
 * @param host - Canvas, tile specs, and React callbacks
 */
export function mountIsoLattice(host: IsoLatticeHost): IsoLatticeHandle {
  const { canvas, tiles, onHover, onSelect } = host;
  const reduced = host.reduced;
  let lit: number | null = null;
  let pointer: number | null = null;
  let palette = readPalette(tiles);
  let markFont = getComputedStyle(canvas).fontFamily || MONO_FALLBACK;
  const born = performance.now();

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = palette.exposure;
  renderer.shadowMap.enabled = true;
  // PCF is the soft filter as of r185 — a Vogel disk rotated per pixel, scaled
  // by `shadow.radius`. `PCFSoftShadowMap` is a deprecated alias for it.
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 60);
  camera.position.copy(CAMERA_DIR).multiplyScalar(18);
  camera.lookAt(0, CAP_H * 0.5, 0);

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envSource = environmentTexture();
  const envMap = pmrem.fromEquirectangular(envSource).texture;
  scene.environment = envMap;

  // The key only shapes the cast shadow and a little lid gradient; the
  // environment does the actual lighting.
  const key = new THREE.DirectionalLight(0xffffff, palette.key);
  key.position.set(-3.6, 9, -2.4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  // Radius is in shadow texels: 5 over this frustum is roughly a 3px penumbra
  // at the on-screen size of a cap.
  key.shadow.radius = 5;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  const shadowCam = key.shadow.camera;
  shadowCam.left = -3.8;
  shadowCam.right = 3.8;
  shadowCam.top = 3.8;
  shadowCam.bottom = -3.8;
  shadowCam.near = 1;
  shadowCam.far = 22;
  shadowCam.updateProjectionMatrix();
  scene.add(key);

  const rim = new THREE.DirectionalLight(0xdce6f5, palette.rim);
  rim.position.copy(CAMERA_DIR).multiplyScalar(6).setY(1.6);
  scene.add(rim);

  const grainMap = grainTexture();
  const grainCanvas = grainMap.image as HTMLCanvasElement;
  const streakMap = streakTexture();
  const skirtMap = skirtTexture();
  const contactMap = discTexture(0.12);
  const poolMap = discTexture(0.02);

  const lidGeo = lidGeometry(SIZE, RADIUS, LID_H, BEVEL);
  const wallGeo = wallGeometry(
    roundedLoop(SIZE * WALL_INSET, RADIUS * WALL_INSET, 3),
    WALL_H,
    STREAK_REPEAT,
  );
  const skirtGeo = wallGeometry(
    roundedLoop(SIZE * 1.075, RADIUS * 1.075, 3),
    CAP_H * 1.5,
    STREAK_REPEAT,
  );
  const discGeo = new THREE.PlaneGeometry(1, 1);
  const pickGeo = new THREE.BoxGeometry(SIZE, CAP_H, SIZE);
  const dropGeo = new THREE.BufferGeometry();
  dropGeo.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 1, 0], 3));
  dropGeo.setAttribute("lineDistance", new THREE.Float32BufferAttribute([0, 1], 1));

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(24, 24),
    new THREE.ShadowMaterial({ opacity: palette.shadow }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.raycast = () => undefined;
  scene.add(ground);

  const pickMat = new THREE.MeshBasicMaterial({ visible: false });
  const dropCorner = SIZE / 2 - RADIUS + RADIUS * Math.SQRT1_2;

  /** Left-to-right on screen, so the build reads as one sweep across the field. */
  const screenOrder = tiles
    .map((_, index) => {
      const seat = seatXZ(index);
      return { index, screenX: seat.z - seat.x };
    })
    .sort((a, b) => a.screenX - b.screenX)
    .map((entry) => entry.index);

  const rigs: CapRig[] = tiles.map((tile, index) => {
    const seat = seatXZ(index);
    const tone = (palette.tones[index] ?? new THREE.Color("#ffffff")).clone();
    const cap = new THREE.Group();
    cap.position.set(seat.x, 0, seat.z);

    const lidMat = new THREE.MeshPhysicalMaterial({
      map: lidTexture(tile.symbol, palette, grainCanvas, markFont),
      roughness: palette.lidRoughness,
      roughnessMap: grainMap,
      bumpMap: grainMap,
      bumpScale: 0.18,
      metalness: 0,
      clearcoat: palette.clearcoat,
      clearcoatRoughness: 0.32,
      envMapIntensity: palette.envIntensity,
      emissive: tone,
      emissiveMap: markTexture(tile.symbol, markFont),
      emissiveIntensity: 0,
    });
    const lid = new THREE.Mesh(lidGeo, lidMat);
    lid.position.y = WALL_H;
    lid.castShadow = true;
    lid.receiveShadow = true;
    lid.raycast = () => undefined;
    cap.add(lid);

    const wallMat = new THREE.MeshStandardMaterial({
      color: palette.wall,
      roughness: 0.5,
      metalness: 0,
      envMapIntensity: palette.envIntensity * 0.7,
      emissive: tone,
      emissiveMap: streakMap,
      emissiveIntensity: 0,
    });
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.castShadow = true;
    wall.raycast = () => undefined;
    cap.add(wall);

    const skirtMat = new THREE.MeshBasicMaterial({
      map: skirtMap,
      color: tone,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const skirt = new THREE.Mesh(skirtGeo, skirtMat);
    skirt.position.y = -CAP_H * 0.28;
    skirt.renderOrder = 3;
    skirt.raycast = () => undefined;
    cap.add(skirt);

    const pick = new THREE.Mesh(pickGeo, pickMat);
    pick.position.y = CAP_H / 2;
    pick.userData.index = index;
    cap.add(pick);

    const contactMat = new THREE.MeshBasicMaterial({
      map: contactMap,
      color: 0x000000,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    });
    const contact = new THREE.Mesh(discGeo, contactMat);
    contact.rotation.x = -Math.PI / 2;
    contact.position.set(seat.x + 0.05, 0.0015, seat.z + 0.03);
    contact.renderOrder = 1;
    contact.raycast = () => undefined;
    scene.add(contact);

    const poolMat = new THREE.MeshBasicMaterial({
      map: poolMap,
      color: tone,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const pool = new THREE.Mesh(discGeo, poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(seat.x, 0.003, seat.z);
    pool.renderOrder = 2;
    pool.raycast = () => undefined;
    scene.add(pool);

    const drops: THREE.Line[] = [];
    const dropMats: THREE.LineDashedMaterial[] = [];
    for (const [dx, dz] of [
      [-dropCorner, dropCorner],
      [dropCorner, -dropCorner],
      [dropCorner, dropCorner],
    ] as const) {
      const material = new THREE.LineDashedMaterial({
        color: palette.drop,
        dashSize: 0.05,
        gapSize: 0.045,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      });
      const line = new THREE.Line(dropGeo, material);
      line.position.set(seat.x + dx, 0.004, seat.z + dz);
      line.renderOrder = 2;
      line.visible = false;
      line.raycast = () => undefined;
      scene.add(line);
      drops.push(line);
      dropMats.push(material);
    }

    scene.add(cap);
    return {
      cap,
      pick,
      lidMat,
      wallMat,
      skirtMat,
      poolMat,
      contactMat,
      pool,
      contact,
      drops,
      dropMats,
      tone,
      wallBase: palette.wall.clone(),
      delay: reduced ? 0 : 140 + screenOrder.indexOf(index) * 70,
      lift: 0,
      appear: reduced ? 1 : 0,
    };
  });

  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const pickables = rigs.map((rig) => rig.pick);

  /** Frame the whole field, lift headroom included, for the live canvas box. */
  const fit = (): void => {
    const box = canvas.getBoundingClientRect();
    const w = Math.max(1, box.width);
    const h = Math.max(1, box.height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);

    camera.updateMatrixWorld(true);
    const spanX = ((COLS - 1) * STRIDE + SIZE) / 2;
    const spanZ = ((ROWS - 1) * STRIDE + SIZE) / 2;
    const corner = new THREE.Vector3();
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const sx of [-spanX, spanX]) {
      for (const sz of [-spanZ, spanZ]) {
        for (const sy of [0, CAP_H + LIFT]) {
          corner.set(sx, sy, sz).applyMatrix4(camera.matrixWorldInverse);
          minX = Math.min(minX, corner.x);
          maxX = Math.max(maxX, corner.x);
          minY = Math.min(minY, corner.y);
          maxY = Math.max(maxY, corner.y);
        }
      }
    }

    minX -= PAD;
    maxX += PAD;
    maxY += PAD;
    minY -= PAD_FLOOR;

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    let halfW = (maxX - minX) / 2;
    let halfH = (maxY - minY) / 2;
    if (halfW / halfH > w / h) halfH = (halfW * h) / w;
    else halfW = (halfH * w) / h;
    camera.left = cx - halfW;
    camera.right = cx + halfW;
    camera.top = cy + halfH;
    camera.bottom = cy - halfH;
    camera.updateProjectionMatrix();
  };

  /**
   * Repaint what a theme flip actually changes: the element inks and the marks
   * the field leaves on the page. The cap's own maps and the studio are shared
   * between themes, so nothing here rebuilds a texture.
   */
  const applyPalette = (): void => {
    palette = readPalette(tiles);

    const groundMat = ground.material;
    if (groundMat instanceof THREE.ShadowMaterial) groundMat.opacity = palette.shadow;

    for (const [i, rig] of rigs.entries()) {
      rig.tone.copy(palette.tones[i] ?? rig.tone);
      rig.lidMat.emissive.copy(rig.tone);
      rig.wallMat.emissive.copy(rig.tone);
      rig.skirtMat.color.copy(rig.tone);
      rig.poolMat.color.copy(rig.tone);
      for (const material of rig.dropMats) material.color.copy(palette.drop);
    }
  };

  /** Redraw the marks once the mono webfont has actually landed. */
  const refreshMarks = (): void => {
    markFont = getComputedStyle(canvas).fontFamily || MONO_FALLBACK;
    for (const [i, rig] of rigs.entries()) {
      const spec = tiles[i];
      if (!spec) continue;
      rig.lidMat.map?.dispose();
      rig.lidMat.map = lidTexture(spec.symbol, palette, grainCanvas, markFont);
      rig.lidMat.emissiveMap?.dispose();
      rig.lidMat.emissiveMap = markTexture(spec.symbol, markFont);
      rig.lidMat.needsUpdate = true;
    }
  };

  const pickAt = (clientX: number, clientY: number): number | null => {
    const box = canvas.getBoundingClientRect();
    pointerNdc.x = ((clientX - box.left) / box.width) * 2 - 1;
    pointerNdc.y = -((clientY - box.top) / box.height) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);
    const hit = raycaster.intersectObjects(pickables, false)[0];
    const index = hit?.object.userData.index;
    return typeof index === "number" ? index : null;
  };

  const onMove = (event: PointerEvent): void => {
    const next = pickAt(event.clientX, event.clientY);
    if (next === pointer) return;
    pointer = next;
    canvas.style.cursor = next === null ? "default" : "pointer";
    onHover(next);
  };

  const onLeave = (): void => {
    if (pointer === null) return;
    pointer = null;
    canvas.style.cursor = "default";
    onHover(null);
  };

  const onClick = (event: MouseEvent): void => {
    const index = pickAt(event.clientX, event.clientY);
    if (index === null) return;
    onSelect(index, event);
  };

  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("click", onClick);

  const approach = (current: number, target: number, dt: number, rate: number): number =>
    current + (target - current) * (1 - Math.exp(-dt * rate));

  let last = performance.now();
  let raf = 0;
  let onScreen = true;
  let running = true;
  let dirty = true;

  const frame = (now: number): void => {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    let moving = false;

    for (const [i, rig] of rigs.entries()) {
      const appearTarget = reduced || now - born > rig.delay ? 1 : 0;
      const appear = reduced ? 1 : approach(rig.appear, appearTarget, dt, 6.5);
      const liftTarget = lit === i && appear > 0.9 ? LIFT : 0;
      const lift = reduced ? liftTarget : approach(rig.lift, liftTarget, dt, 9);
      if (Math.abs(appear - rig.appear) > 0.0002 || Math.abs(lift - rig.lift) > 0.0002) {
        moving = true;
      }
      rig.appear = appear;
      rig.lift = lift;

      rig.cap.position.y = lift + (1 - appear) * 0.85;
      rig.cap.scale.setScalar(0.82 + appear * 0.18);
      rig.cap.visible = appear > 0.01;

      const t = lift / LIFT;
      const settle = appear * appear;
      rig.wallMat.color.lerpColors(rig.wallBase, rig.tone, t * 0.5);
      rig.wallMat.emissiveIntensity = t * palette.wallEmissive;
      rig.lidMat.emissiveIntensity = t * palette.markEmissive;
      rig.skirtMat.opacity = t * palette.skirt * settle;
      rig.poolMat.opacity = t * palette.pool * settle;
      rig.contactMat.opacity = palette.contact * settle * (1 - t * 0.55);
      rig.contact.scale.setScalar(SIZE * (1.55 + t * 0.55));
      rig.pool.scale.setScalar(SIZE * (1.75 + t * 0.6));

      const show = lift > 0.04;
      for (const line of rig.drops) {
        line.visible = show;
        if (show) line.scale.y = lift;
      }
      for (const material of rig.dropMats) {
        material.opacity = palette.dropOpacity * t * settle;
        // Dashes live in unscaled geometry space, so the pattern has to shrink
        // as the line stretches or the dash length would track the lift.
        material.dashSize = 0.05 / Math.max(lift, 0.001);
        material.gapSize = 0.045 / Math.max(lift, 0.001);
      }
    }

    if (onScreen && (moving || dirty)) {
      renderer.render(scene, camera);
      dirty = false;
    }
    raf = window.requestAnimationFrame(frame);
  };

  fit();
  renderer.render(scene, camera);
  canvas.classList.add("is-ready");
  raf = window.requestAnimationFrame(frame);

  void document.fonts?.ready.then(() => {
    if (!running) return;
    refreshMarks();
    dirty = true;
  });

  const ro = new ResizeObserver(() => {
    fit();
    dirty = true;
  });
  ro.observe(canvas.parentElement ?? canvas);
  const io = new IntersectionObserver((entries) => {
    onScreen = entries.some((entry) => entry.isIntersecting);
  });
  io.observe(canvas);
  const mo = new MutationObserver(() => {
    applyPalette();
    dirty = true;
  });
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

  return {
    setLit(index) {
      if (lit === index) return;
      lit = index;
      dirty = true;
    },
    dispose() {
      running = false;
      window.cancelAnimationFrame(raf);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("click", onClick);
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
      canvas.classList.remove("is-ready");
      for (const rig of rigs) {
        rig.lidMat.map?.dispose();
        rig.lidMat.emissiveMap?.dispose();
        rig.lidMat.dispose();
        rig.wallMat.dispose();
        rig.skirtMat.dispose();
        rig.poolMat.dispose();
        rig.contactMat.dispose();
        for (const material of rig.dropMats) material.dispose();
      }
      pickMat.dispose();
      lidGeo.dispose();
      wallGeo.dispose();
      skirtGeo.dispose();
      discGeo.dispose();
      pickGeo.dispose();
      dropGeo.dispose();
      ground.geometry.dispose();
      const groundMat = ground.material;
      if (groundMat instanceof THREE.ShadowMaterial) groundMat.dispose();
      grainMap.dispose();
      streakMap.dispose();
      skirtMap.dispose();
      contactMap.dispose();
      poolMap.dispose();
      envMap.dispose();
      envSource.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}
