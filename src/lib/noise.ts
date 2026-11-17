// Small deterministic noise + math helpers shared by world generation.

export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Seeded PRNG so the world is identical on every load. */
export function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(ix: number, iy: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Value noise in [0,1]. */
export function noise2(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Fractal value noise in [0,1]. */
export function fbm2(x: number, y: number, octaves = 4): number {
  let v = 0, amp = 0.5, f = 1, sum = 0;
  for (let i = 0; i < octaves; i++) {
    v += amp * noise2(x * f + i * 17.3, y * f - i * 9.1);
    sum += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return v / sum;
}

/** 3D-ish noise for displacing blobs (clouds, foliage, rocks). */
export function noise3(x: number, y: number, z: number): number {
  return (noise2(x + z * 1.7, y - z * 0.9) + noise2(y + 31.4, z + x * 0.6)) * 0.5;
}

/** GLSL counterpart, injected into shaders that need matching noise. */
export const GLSL_NOISE = /* glsl */ `
float kh_hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float kh_noise(vec2 p){
  vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(kh_hash(i),kh_hash(i+vec2(1,0)),u.x), mix(kh_hash(i+vec2(0,1)),kh_hash(i+vec2(1,1)),u.x), u.y);
}
float kh_fbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<4;i++){ v+=a*kh_noise(p); p=p*2.03+vec2(1.7,9.2); a*=0.5;} return v/0.9375; }
`;
