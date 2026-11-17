#version 300 es
in vec2 vTextureCoord;
out vec4 finalColor;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;

uniform sampler2D uTexture;
uniform vec2 uRes;
uniform float uTime;
uniform float uDay;   // 0=midnight .25=dawn .5=noon .75=dusk
uniform float uWind;

// ---------- noise ----------
float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y);
}
float fbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p=p*2.03+vec2(1.7,9.2); a*=0.5;} return v; }

// ---------- palette over the day ----------
struct Light { vec3 skyTop; vec3 skyLow; vec3 sun; vec3 amb; vec3 cloudLit; vec3 cloudShade; float night; };

void keyAt(int k, out vec3 T, out vec3 Lo, out vec3 S){
  if (k==1){ T=vec3(0.36,0.44,0.70); Lo=vec3(0.99,0.76,0.62); S=vec3(1.0,0.78,0.58); }
  else if (k==2){ T=vec3(0.28,0.56,0.88); Lo=vec3(0.80,0.91,0.96); S=vec3(1.0,0.97,0.88); }
  else if (k==3){ T=vec3(0.32,0.27,0.54); Lo=vec3(1.00,0.62,0.40); S=vec3(1.0,0.62,0.40); }
  else { T=vec3(0.05,0.07,0.18); Lo=vec3(0.15,0.17,0.33); S=vec3(0.45,0.52,0.80); }
}

Light lightAt(float d){
  float t = fract(d)*4.0; int k = int(floor(t)); float f = smoothstep(0.0,1.0,fract(t));
  vec3 T0,L0,S0,T1,L1,S1;
  keyAt(k, T0,L0,S0); keyAt(k+1==4 ? 0 : k+1, T1,L1,S1);
  Light l;
  l.skyTop=mix(T0,T1,f); l.skyLow=mix(L0,L1,f); l.sun=mix(S0,S1,f);
  float dd=fract(d);
  l.night = 1.0 - smoothstep(0.19,0.28,dd) * (1.0 - smoothstep(0.72,0.81,dd));
  l.amb = mix(l.skyLow, l.skyTop, 0.5);
  l.cloudLit = mix(vec3(1.0,0.98,0.95), l.sun*1.05, 0.55) * (1.0-0.6*l.night);
  l.cloudShade = mix(l.skyTop, vec3(0.55,0.60,0.78), 0.4) * (1.0-0.3*l.night);
  return l;
}

float hillY(float hx){
  return 0.20 + 0.30*smoothstep(0.15,1.0,hx) - 0.06*smoothstep(0.75,1.0,hx) + 0.025*sin(hx*9.0) + 0.02*fbm(vec2(hx*4.0,1.0));
}

// painterly "gouache" edge: noisy threshold
float paint(float sdf, vec2 p, float soft){
  float n = (fbm(p*9.0)-0.5)*0.012 + (noise(p*60.0)-0.5)*0.004;
  return 1.0 - smoothstep(-soft, soft, sdf + n);
}

void main(){
  vec2 uv0 = vTextureCoord * uInputSize.xy / uOutputFrame.zw;
  vec2 uv = vec2(uv0.x, 1.0 - uv0.y); // 0..1, y up
  vec2 frag = uv * uRes;
  float aspect = uRes.x/uRes.y;
  vec2 p = vec2(uv.x*aspect, uv.y); // world-ish coords
  float t = uTime;
  Light L = lightAt(uDay);

  // ---------- sky ----------
  float h = uv.y;
  vec3 col = mix(L.skyLow, L.skyTop, pow(smoothstep(0.25,1.0,h),0.8));

  // sun / moon
  float ang = (fract(uDay)-0.25)*6.2831;
  vec2 sunP  = vec2(aspect*0.5 - cos(ang)*aspect*0.42, 0.30 + sin(ang)*0.55);
  vec2 moonP = vec2(aspect*0.5 + cos(ang)*aspect*0.42, 0.30 - sin(ang)*0.55);
  float sd = length(p-sunP);
  col += L.sun * (0.55*exp(-sd*5.0) + 0.25*exp(-sd*1.6)) * (1.0-L.night);
  col = mix(col, vec3(1.0,0.97,0.86), smoothstep(0.045,0.040,sd)*(1.0-L.night));
  float md = length(p-moonP);
  float moon = smoothstep(0.035,0.031,md) * (1.0-smoothstep(0.03,0.026,length(p-moonP-vec2(0.014,0.008))));
  col += vec3(0.95,0.93,0.82)*moon*L.night + vec3(0.25,0.3,0.5)*exp(-md*6.0)*0.35*L.night;

  // stars
  vec2 sg = floor(p*90.0);
  float st = step(0.992, hash(sg)) * smoothstep(0.4,0.8,h);
  st *= 0.6+0.4*sin(t*2.0+hash(sg+3.1)*40.0);
  col += vec3(0.9,0.92,1.0)*st*L.night;

  // ---------- big cumulus clouds (layered) ----------
  for(int i=0;i<3;i++){
    float fi=float(2-i);
    float spd = 0.006*(1.0+fi*0.6)*uWind;
    vec2 cp = p*vec2(1.6+fi*0.7, 2.6+fi*0.6) + vec2(t*spd*10.0 + fi*7.3, fi*3.1);
    float base = 0.62 - fi*0.10;
    float shape = fbm(cp) + fbm(cp*2.1)*0.35;
    float bottom = smoothstep(base-0.10, base+0.04, h);             // flat bottoms
    float top = 1.0 - smoothstep(base+0.18+fi*0.03, base+0.36, h - (shape-0.5)*0.35);
    float d = shape*bottom*top;
    float a = smoothstep(0.42, 0.50, d) * (0.92 - fi*0.12);
    float lit = clamp((h-base)*3.0 + (fbm(cp*1.6+1.0)-0.45)*1.2, 0.0, 1.0);
    vec3 cc = mix(L.cloudShade, L.cloudLit, lit);
    cc = mix(cc, col, 0.15+fi*0.18); // aerial perspective
    col = mix(col, cc, a);
  }

  // ---------- sea ----------
  float horizon = 0.34;
  if (h < horizon) {
    float dd = (horizon - h)/horizon;
    vec3 sea = mix(mix(L.skyLow, L.skyTop, 0.6)*0.95, vec3(0.10,0.25,0.38)*(0.4+0.6*(1.0-L.night)), smoothstep(0.0,0.8,dd));
    float glint = noise(vec2(p.x*40.0 + t*0.3, (h)*300.0 / (dd+0.05)));
    float sunCol = exp(-abs(p.x - sunP.x)*6.0) * (1.0-L.night) * step(horizon*0.4, sunP.y);
    float moonCol = exp(-abs(p.x - moonP.x)*10.0) * L.night;
    sea += (L.sun*sunCol*0.9 + vec3(0.7,0.75,0.9)*moonCol*0.5) * smoothstep(0.6,0.95,glint);
    col = mix(col, sea, smoothstep(horizon, horizon-0.004, h));
  }

  // ---------- distant headland (blue, misty) ----------
  float far = 0.34 + 0.11*(1.0 - smoothstep(0.0, 0.55*aspect, p.x)) + 0.025*fbm(vec2(p.x*2.5, 2.0));
  float farMask = paint(h - far, p, 0.004) * step(0.30, h);
  col = mix(col, mix(L.skyTop, L.skyLow, 0.5)*vec3(0.72,0.80,0.92), farMask*0.85);

  // ---------- main hill ----------
  float hx = p.x/aspect;
  float hill = hillY(hx);
  float hillMask = paint(h - hill, p, 0.003);
  // grass colour: light on top, painterly patches, wind ripples
  float wave = sin(p.x*14.0 - t*1.6*uWind + fbm(p*3.0)*4.0)*0.5+0.5;
  float patch_ = fbm(p*vec2(6.0,14.0) + vec2(t*0.04*uWind,0.0));
  vec3 gDark = vec3(0.16,0.36,0.22), gMid = vec3(0.36,0.58,0.26), gLite = vec3(0.70,0.80,0.38);
  float depth = clamp((hill - h)/0.25, 0.0, 1.0);
  vec3 grass = mix(gMid, gLite, smoothstep(0.35,0.75,patch_)*0.7 + wave*0.25*(1.0-depth));
  grass = mix(grass, gDark, depth*0.55 + smoothstep(0.55,0.75,fbm(p*18.0))*0.18);
  // lighting
  vec3 lightCol = mix(L.sun, vec3(0.55,0.62,0.95), L.night);
  grass *= mix(vec3(1.0), lightCol, 0.55) * (1.0 - 0.72*L.night);
  grass = mix(grass, L.amb*0.6, 0.12);
  // rim light along ridge
  grass += lightCol * smoothstep(0.012, 0.0, hill - h) * 0.25 * (1.0-L.night);
  // wildflowers
  vec2 fg = floor(p*vec2(140.0,220.0));
  float fl = step(0.985, hash(fg)) * step(0.02, hill-h) * step(h, hill-0.01);
  vec3 flC = mix(vec3(1.0,0.95,0.80), vec3(0.98,0.62,0.66), hash(fg+7.0));
  grass = mix(grass, flC*(1.0-0.6*L.night), fl*0.9);
  col = mix(col, grass, hillMask);

  // grass blades on the ridge silhouette
  float bladeX = p.x*220.0;
  float bid = floor(bladeX);
  float bh = (0.006+0.012*hash(vec2(bid,1.0))) ;
  float sway = sin(t*2.2*uWind + bid*0.37 + fbm(vec2(bid*0.05,t*0.3))*3.0)*0.35;
  float bx = fract(bladeX)-0.5 - sway*((h-hill)/max(bh,0.001));
  float blade = step(hill, h) * step(h, hill+bh) * smoothstep(0.35, 0.1, abs(bx) + (h-hill)/bh*0.3);
  col = mix(col, grass*1.05, blade);

  // ---------- tea house ----------
  vec2 hp = vec2(aspect*0.70, 0.0);
  float groundY = hillY(0.70) - 0.004;
  vec2 q = p - vec2(hp.x, groundY);
  float wallW=0.105, wallH=0.085;
  float wall = max(abs(q.x)-wallW, max(-q.y+0.0, q.y-wallH));
  float roofY = q.y - wallH;
  float roof = max(roofY - (0.075 - abs(q.x)*0.62), max(-roofY-0.004, abs(q.x)-0.15));
  // roof curl (upturned eaves)
  roof = min(roof, length(vec2(abs(q.x)-0.148, roofY-0.004))-0.008);
  vec3 wallC = vec3(0.93,0.85,0.70);
  vec3 roofC = vec3(0.62,0.22,0.18);
  vec3 woodC = vec3(0.36,0.22,0.14);
  float wm = paint(wall, p, 0.0015);
  float rm = paint(roof, p, 0.0015);
  vec3 shadeL = mix(lightCol, L.amb, 0.4) * (1.0-0.65*L.night);
  vec3 wc = wallC * shadeL;
  // timber beams
  float beam = step(abs(abs(q.x)-wallW+0.006),0.004) + step(abs(q.y-wallH+0.006),0.004) + step(abs(q.x),0.003)*step(0.06,q.y);
  wc = mix(wc, woodC*shadeL, clamp(beam,0.0,1.0));
  // windows (warm glow at dusk/night)
  vec2 wq = vec2(abs(q.x)-0.055, q.y-0.045);
  float win = step(abs(wq.x),0.022)*step(abs(wq.y),0.018);
  float glow = clamp(L.night*1.2 + smoothstep(0.65,0.8,fract(uDay))*0.8, 0.0, 1.0);
  vec3 winC = mix(vec3(0.30,0.32,0.38), vec3(1.0,0.78,0.42), glow);
  winC *= 1.0 - 0.25*step(abs(wq.x),0.002) - 0.25*step(abs(wq.y),0.002);
  wc = mix(wc, winC, win);
  // door
  float door = step(abs(q.x),0.016)*step(q.y,0.055);
  wc = mix(wc, woodC*0.8*shadeL, door);
  col = mix(col, wc, wm);
  vec3 rc = roofC * shadeL * (0.85 + 0.25*smoothstep(0.0,0.08, roofY));
  rc *= 0.9 + 0.1*step(0.5, fract((q.x+q.y*0.6)*90.0));  // tiles
  col = mix(col, rc, rm);
  // window light spill
  col += vec3(1.0,0.7,0.35) * glow * 0.18 * exp(-length(q-vec2(0.0,0.03))*14.0) * (1.0-wm);
  // chimney smoke
  vec2 sq = q - vec2(0.07, wallH+0.06);
  float smokeH = sq.y;
  float smoke = smoothstep(0.0,0.02,smokeH) * (1.0 - smoothstep(0.05,0.30,smokeH));
  float sx = sq.x - smokeH*0.6*uWind - sin(smokeH*30.0 - t*1.5)*0.012*smokeH*8.0;
  smoke *= smoothstep(0.012+smokeH*0.12, 0.0, abs(sx)) * fbm(vec2(sx*20.0, smokeH*12.0 - t*0.6));
  col = mix(col, mix(vec3(0.95), L.amb, 0.4), clamp(smoke*1.6,0.0,0.55));

  // lantern on post, left of house
  vec2 lq = q - vec2(-0.16, 0.0);
  float post = step(abs(lq.x),0.0025)*step(0.0,lq.y)*step(lq.y,0.07);
  col = mix(col, woodC*0.6*shadeL, post);
  float lant = length((lq - vec2(0.0,0.075))*vec2(1.0,0.8));
  col = mix(col, mix(vec3(0.7,0.3,0.2)*shadeL, vec3(1.0,0.75,0.4), glow), smoothstep(0.012,0.010,lant));
  col += vec3(1.0,0.65,0.3)*glow*0.35*exp(-lant*25.0);

  // ---------- lone tree on the left ----------
  vec2 tq = p - vec2(aspect*0.18, hillY(0.18) - 0.004);
  float trunk = max(abs(tq.x + tq.y*0.08)-0.008+tq.y*0.02, max(-tq.y, tq.y-0.13));
  float canopyN = fbm(tq*14.0 + vec2(t*0.25*uWind, 0.0));
  float canopy = length((tq-vec2(0.01 + 0.004*sin(t*uWind), 0.18))*vec2(1.0,1.25)) - 0.10 - (canopyN-0.5)*0.07;
  vec3 leafC = mix(vec3(0.14,0.33,0.20), vec3(0.45,0.66,0.30), smoothstep(-0.05,0.08, tq.y-0.15 + (canopyN-0.5)*0.1));
  leafC *= mix(vec3(1.0), lightCol, 0.5) * (1.0-0.72*L.night);
  col = mix(col, woodC*0.7*shadeL, paint(trunk, p, 0.0015));
  col = mix(col, leafC, paint(canopy, p, 0.002));

  // ---------- fireflies (night) ----------
  for(int i=0;i<14;i++){
    float fi=float(i);
    vec2 fp = vec2(hash(vec2(fi,1.3))*aspect, 0.06+hash(vec2(fi,7.7))*0.30);
    fp += vec2(sin(t*0.4+fi*2.1), cos(t*0.33+fi*1.3))*0.03;
    float blink = smoothstep(0.3,1.0,sin(t*1.7+fi*3.7));
    col += vec3(0.85,1.0,0.55)*exp(-length(p-fp)*180.0)*blink*L.night*1.2;
  }

  // ---------- drifting petals / seeds (day) ----------
  for(int i=0;i<10;i++){
    float fi=float(i);
    float x = fract(hash(vec2(fi,2.0)) + t*0.02*uWind*(0.6+hash(vec2(fi,5.0))));
    vec2 pp = vec2(x*aspect, 0.2+hash(vec2(fi,9.0))*0.6 + sin(t*0.9+fi)*0.03);
    col = mix(col, vec3(1.0,0.92,0.94), smoothstep(0.004,0.002,length((p-pp)*vec2(1.0,1.8)))*0.8*(1.0-L.night));
  }

  // ---------- grade: paper grain, warm bloom, vignette ----------
  float grain = (hash(frag + fract(t)*10.0) - 0.5) * 0.035;
  float paper = (fbm(frag*0.02) - 0.5) * 0.06;
  col += grain + paper*vec3(0.9,0.85,0.7);
  col = mix(col, col*vec3(1.04,1.0,0.94), 0.5);              // warm paper tint
  float vig = smoothstep(1.2, 0.35, length((uv-0.5)*vec2(aspect*0.75,1.0)));
  col *= mix(0.78, 1.0, vig);
  col = pow(max(col,0.0), vec3(0.95));
  finalColor = vec4(col, 1.0);
}
