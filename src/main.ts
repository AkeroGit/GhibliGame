import { Application, Filter, GlProgram, Sprite, Texture, defaultFilterVert } from 'pixi.js';
import sceneFrag from './shaders/scene.frag?raw';

/**
 * Kettle Hill — Phase 0 style test.
 * The whole scene is one painterly fragment shader for now; later phases split it into
 * layered parallax sprites, but this lets us lock in the look first.
 *
 * URL params (used by the screenshot script, handy for you too):
 *   ?day=0.25        fixed time of day (0 midnight, .25 dawn, .5 noon, .75 dusk)
 *   ?speed=0.01      day-cycle speed in days per second (default: one day per 4 minutes)
 *   ?t=12            start the animation clock at 12s
 *   ?freeze=1        stop animating (for stills)
 */
const params = new URLSearchParams(location.search);
const fixedDay = params.has('day') ? Number(params.get('day')) : null;
const daySpeed = Number(params.get('speed') ?? 1 / 240);
const freeze = params.get('freeze') === '1';
let clock = Number(params.get('t') ?? 0);

async function boot() {
  const app = new Application();
  await app.init({
    resizeTo: window,
    preference: 'webgl',
    antialias: false,
    background: '#1c1a24',
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
  });
  document.body.appendChild(app.canvas);

  const canvasSprite = new Sprite(Texture.WHITE);
  const uniforms = {
    uRes: { value: new Float32Array([1, 1]), type: 'vec2<f32>' as const },
    uTime: { value: clock, type: 'f32' as const },
    uDay: { value: fixedDay ?? 0.3, type: 'f32' as const },
    uWind: { value: 1.0, type: 'f32' as const },
  };
  const filter = new Filter({
    glProgram: new GlProgram({ vertex: defaultFilterVert, fragment: sceneFrag, name: 'kettle-scene', preferredFragmentPrecision: 'highp' }),
    resources: { sceneUniforms: uniforms },
  });
  canvasSprite.filters = [filter];
  app.stage.addChild(canvasSprite);

  const fit = () => {
    canvasSprite.width = app.screen.width;
    canvasSprite.height = app.screen.height;
    filter.resources.sceneUniforms.uniforms.uRes = new Float32Array([
      app.screen.width * app.renderer.resolution,
      app.screen.height * app.renderer.resolution,
    ]);
  };
  fit();
  app.renderer.on('resize', fit);

  let day = fixedDay ?? 0.3;
  app.ticker.add((tk) => {
    if (freeze) return;
    const dt = tk.deltaMS / 1000;
    clock += dt;
    if (fixedDay === null) day = (day + dt * daySpeed) % 1;
    // gentle gusts: the wind is a character
    const wind = 1.0 + 0.35 * Math.sin(clock * 0.21) + 0.2 * Math.sin(clock * 0.53 + 1.3);
    const u = filter.resources.sceneUniforms.uniforms;
    u.uTime = clock;
    u.uDay = day;
    u.uWind = wind;
  });

  if (freeze) app.ticker.addOnce(() => app.ticker.stop());
  app.renderer.render(app.stage);
  (window as unknown as { __ready: boolean }).__ready = true;
}

boot().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<pre style="color:#eee;padding:1rem">Failed to start: ${String(err)}</pre>`;
});
