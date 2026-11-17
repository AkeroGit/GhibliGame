import * as THREE from 'three';
import { mulberry32, fbm2, smoothstep } from '../lib/noise';
import { globalUniforms } from '../render/toon';
import { heightAt, surfaceAt } from './terrain';

/**
 * Wind-blown grass: instanced tapered blades. Colour comes from the painted ground below,
 * brightening towards the tip; gusts roll across the meadow as visible waves.
 */
export function createGrass(count = 140000, radius = 78) {
  // One blade: 7 verts, curved, tapered.
  const segs = 3;
  const pos: number[] = [];
  const uv: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const w = 0.5 * (1 - t) ** 0.9;
    if (i < segs) {
      pos.push(-w, t, 0, w, t, 0);
      uv.push(0, t, 1, t);
    } else {
      pos.push(0, 1, 0);
      uv.push(0.5, 1);
    }
  }
  const index: number[] = [];
  for (let i = 0; i < segs - 1; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const last = (segs - 1) * 2;
  index.push(last, last + 1, last + 2);

  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);

  const rand = mulberry32(1337);
  const offsets = new Float32Array(count * 4); // xyz + yaw
  const shape = new Float32Array(count * 3); // height, width, lean
  const colors = new Float32Array(count * 3);
  let n = 0;
  let tries = 0;
  while (n < count && tries < count * 6) {
    tries++;
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * radius;
    const x = Math.cos(a) * r + 2, z = Math.sin(a) * r * 0.95 + 4;
    const surf = surfaceAt(x, z);
    // clumpy density: meadows have thick and thin patches
    const clump = fbm2(x * 0.15 + 5, z * 0.15 - 3, 3);
    const keep = surf.grassiness * (0.35 + 0.9 * smoothstep(0.3, 0.6, clump));
    if (rand() > keep) continue;
    const y = heightAt(x, z);
    if (y < 0.3) continue;
    offsets.set([x, y - 0.02, z, rand() * Math.PI * 2], n * 4);
    const tall = 0.35 + 0.5 * smoothstep(0.35, 0.75, clump) + rand() * 0.25;
    shape.set([tall, 0.05 + rand() * 0.04, (rand() - 0.5) * 0.5], n * 3);
    colors.set([surf.color.r, surf.color.g, surf.color.b], n * 3);
    n++;
  }
  geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets.subarray(0, n * 4), 4));
  geo.setAttribute('aShape', new THREE.InstancedBufferAttribute(shape.subarray(0, n * 3), 3));
  geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors.subarray(0, n * 3), 3));
  geo.instanceCount = n;

  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
  Object.assign(uniforms, globalUniforms, {
    uSkyCol: { value: new THREE.Color() },
    uGroundCol: { value: new THREE.Color() },
    uSunI: { value: 1 },
  });

  const mat = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      attribute vec4 aOffset;
      attribute vec3 aShape;
      attribute vec3 aColor;
      uniform float uTime, uWind;
      uniform vec2 uWindDir;
      varying vec3 vCol;
      varying float vT;
      varying float vGust;
      float h1(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
      float n1(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
        return mix(mix(h1(i),h1(i+vec2(1,0)),u.x), mix(h1(i+vec2(0,1)),h1(i+vec2(1,1)),u.x), u.y); }
      void main(){
        float t = position.y;
        float c = cos(aOffset.w), s = sin(aOffset.w);
        vec3 p = vec3(position.x * aShape.y, t * aShape.x, 0.0);
        p = vec3(p.x * c, p.y, p.x * s);
        vec2 wp = aOffset.xz;
        // rolling gust waves across the meadow
        float gust = n1(wp * 0.06 - uWindDir * uTime * 0.55);
        gust = smoothstep(0.25, 0.85, gust);
        float flutter = sin(uTime * 3.1 + wp.x * 1.7 + wp.y * 1.3) * 0.12;
        float bend = (0.25 + gust * 0.9) * uWind + flutter + aShape.z * 0.3;
        float k = t * t;
        p.xz += uWindDir * bend * k * aShape.x * 0.9;
        p.y -= abs(bend) * k * aShape.x * 0.28;
        vec3 world = aOffset.xyz + p;
        vCol = aColor;
        vT = t;
        vGust = gust;
        vec4 mvPosition = viewMatrix * vec4(world, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform vec3 uSunColor, uSkyCol, uGroundCol;
      uniform float uNight, uSunI;
      varying vec3 vCol;
      varying float vT;
      varying float vGust;
      void main(){
        // root sinks into the ground colour, tips catch the light
        vec3 base = vCol * 0.62;
        vec3 tip = mix(vCol * 1.22, vec3(0.86, 0.92, 0.55), 0.18);
        vec3 col = mix(base, tip, smoothstep(0.0, 1.0, vT));
        // gust sheen: bent blades show their lighter backs
        col = mix(col, col * 1.18 + vec3(0.04, 0.05, 0.0), vGust * vT * 0.6);
        vec3 light = mix(uSkyCol * 0.75, uSunColor * (0.55 + 0.25 * uSunI), 0.65);
        col *= light;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return {
    mesh,
    count: n,
    update(sky: THREE.Color, ground: THREE.Color, sunI: number) {
      uniforms.uSkyCol.value.copy(sky);
      uniforms.uGroundCol.value.copy(ground);
      uniforms.uSunI.value = sunI;
    },
  };
}
