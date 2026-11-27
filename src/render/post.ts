import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * Final "painted cel" grade:
 *  - soft bloom on lanterns, sun, glitter
 *  - gentle saturation lift + warm/cool split toning (warm lights, cool shadows)
 *  - paper grain + subtle canvas weave, soft vignette
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uNight: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; uniform float uNight;
    varying vec2 vUv;
    float h(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
    float n(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
      return mix(mix(h(i),h(i+vec2(1,0)),u.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),u.x), u.y); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float lum = dot(c, vec3(0.299, 0.587, 0.114));
      // saturation lift, gentler in the darks
      c = mix(vec3(lum), c, 1.12 + 0.08 * smoothstep(0.2, 0.7, lum));
      // split toning: cool shadows, warm highlights
      vec3 cool = vec3(0.86, 0.92, 1.14), warm = vec3(1.06, 1.0, 0.92);
      c *= mix(cool, warm, smoothstep(0.1, 0.65, lum));
      // lift the blacks slightly (no pure black in watercolour)
      c = c * 0.97 + vec3(0.012, 0.014, 0.022);
      // paper: coarse fibres + fine grain
      vec2 px = vUv * uRes;
      float fib = (n(px * 0.012) - 0.5) * 0.035 + (n(px * 0.08 + 3.0) - 0.5) * 0.02;
      // paper grain is part of the paper, so it stays still (animated grain reads as flicker)
      float grain = (h(px + 17.0) - 0.5) * 0.022;
      c += (fib + grain) * mix(1.0, 0.6, uNight);
      // vignette
      vec2 q = vUv - 0.5;
      float v = smoothstep(0.85, 0.25, length(q * vec2(1.0, 0.85)));
      c *= mix(0.82, 1.0, v);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, samples = 4) {
  // The composer renders into its own target, so the canvas's antialias flag does nothing:
  // give the scene target real MSAA or every grass blade and railing edge shimmers.
  const pr0 = renderer.getPixelRatio(), sz0 = renderer.getSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(sz0.x * pr0, sz0.y * pr0, { type: THREE.HalfFloatType, samples });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const size = renderer.getSize(new THREE.Vector2());
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.35, 0.6, 0.82);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);

  return {
    composer,
    setSize(w: number, h: number, pr: number) {
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
      grade.uniforms.uRes.value.set(w * pr, h * pr);
    },
    update(time: number, night: number) {
      grade.uniforms.uTime.value = time;
      grade.uniforms.uNight.value = night;
      bloom.strength = 0.22 + night * 0.32;
      bloom.threshold = 0.93 - night * 0.25;
    },
  };
}
