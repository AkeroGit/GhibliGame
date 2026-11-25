import * as THREE from 'three';
import { toon } from '../render/toon';
import { tube } from '../lib/geo';

/**
 * Hand-built player character: a young tea-keeper in a straw hat.
 * Original design: dark bob haircut with soft jagged locks, cream blouse, indigo pinafore
 * dress, red neckerchief, canvas satchel, wide straw hat with a red ribbon.
 *
 * Built as a jointed hierarchy so it can be animated procedurally:
 *   root > hips > (spine > chest > neck > head, shoulders > upper > fore > hand), (thigh > shin > foot)
 * Height ~1.55 m. Rest pose faces +Z.
 */

export interface CharacterRig {
  root: THREE.Group;
  hips: THREE.Group;
  spine: THREE.Group;
  chest: THREE.Group;
  head: THREE.Group;
  arms: { upper: THREE.Group; fore: THREE.Group }[];
  legs: { thigh: THREE.Group; shin: THREE.Group; foot: THREE.Group }[];
  skirt: THREE.Mesh;
  ribbons: THREE.Mesh[];
  hairBack: THREE.Group;
  eyes: THREE.Mesh[];
  satchel: THREE.Group;
}

const C = {
  skin: '#f3c7a6',
  cheek: '#f29a8a',
  hair: '#3a2a30',
  hairLight: '#54404a',
  blouse: '#f4ead6',
  dress: '#4a5482',
  dressDark: '#363e66',
  kerchief: '#d9534a',
  straw: '#e8c477',
  strawDark: '#c99c4f',
  ribbon: '#d24a45',
  satchel: '#a0714b',
  strap: '#6e4a33',
  sock: '#efe6d6',
  shoe: '#5a3a2c',
  eye: '#2a2030',
};

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, cast = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

/** Smooth body shell from a radius profile [y, r] (lathe), optionally squashed front-to-back. */
function shell(profile: [number, number][], segs = 20, depth = 1): THREE.BufferGeometry {
  const pts = profile[0][0] > profile[profile.length - 1][0] ? [...profile].reverse() : profile;
  const g = new THREE.LatheGeometry(pts.map(([y, r]) => new THREE.Vector2(r, y)), segs);
  g.scale(1, 1, depth);
  g.computeVertexNormals();
  return g;
}

/** A soft limb segment: tapered capsule from (0,0,0) down to (0,-len,0). */
function limb(len: number, r0: number, r1: number): THREE.BufferGeometry {
  const g = shell([[0.0001 - r0 * 0.6, 0], [-r0 * 0.15, r0 * 0.75], [0, r0], [-len * 0.5, (r0 + r1) * 0.5], [-len, r1], [-len - r1 * 0.5, r1 * 0.7], [-len - r1, 0.0001]].map(([y, r]) => [y, r] as [number, number]), 12);
  return g;
}

export function createCharacter(): CharacterRig {
  const M = {
    skin: toon({ color: C.skin, rim: 0.35, emissive: '#5a2a1a', emissiveIntensity: 0.18 }),
    cheek: toon({ color: C.cheek, rim: 0.0 }),
    hair: toon({ color: C.hair, rim: 0.45 }),
    hairLight: toon({ color: C.hairLight, rim: 0.45 }),
    blouse: toon({ color: C.blouse, rim: 0.3 }),
    dress: toon({ color: C.dress, rim: 0.4, side: THREE.DoubleSide }),
    dressDark: toon({ color: C.dressDark, rim: 0.3 }),
    kerchief: toon({ color: C.kerchief, rim: 0.4, side: THREE.DoubleSide }),
    straw: toon({ color: C.straw, rim: 0.45, side: THREE.DoubleSide }),
    strawDark: toon({ color: C.strawDark, rim: 0.3, side: THREE.DoubleSide }),
    ribbon: toon({ color: C.ribbon, rim: 0.4, side: THREE.DoubleSide }),
    satchel: toon({ color: C.satchel, rim: 0.3 }),
    strap: toon({ color: C.strap, rim: 0.2 }),
    sock: toon({ color: C.sock, rim: 0.25 }),
    shoe: toon({ color: C.shoe, rim: 0.3 }),
    eye: new THREE.MeshBasicMaterial({ color: C.eye }),
    white: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
  };

  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = 0.78;
  root.add(hips);

  // ---------- pinafore skirt: flared bell with a soft hem wave ----------
  const skirtGeo = shell([[0.06, 0.155], [0.0, 0.17], [-0.12, 0.21], [-0.26, 0.26], [-0.36, 0.29], [-0.38, 0.285]], 28, 0.86);
  {
    const p = skirtGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y < -0.2) {
        const a = Math.atan2(p.getZ(i), p.getX(i));
        const k = (-0.2 - y) / 0.18;
        p.setY(i, y + Math.sin(a * 7) * 0.012 * k); // gentle pleated hem
        const r = 1 + Math.cos(a * 7) * 0.035 * k;
        p.setX(i, p.getX(i) * r); p.setZ(i, p.getZ(i) * r);
      }
    }
    skirtGeo.computeVertexNormals();
  }
  const skirt = mesh(skirtGeo, M.dress);
  hips.add(skirt);

  // ---------- spine / chest ----------
  const spine = new THREE.Group();
  spine.position.y = 0.04;
  hips.add(spine);
  const chest = new THREE.Group();
  chest.position.y = 0.2;
  spine.add(chest);
  // blouse torso (narrow waist -> soft shoulders)
  const torso = mesh(shell([[-0.24, 0.0001], [-0.23, 0.13], [-0.14, 0.135], [-0.02, 0.15], [0.1, 0.165], [0.17, 0.15], [0.21, 0.1], [0.23, 0.05], [0.235, 0.0001]], 22, 0.74), M.blouse);
  chest.add(torso);
  // pinafore bib over the blouse
  const bib = mesh(shell([[-0.24, 0.145], [-0.1, 0.14], [0.05, 0.152], [0.12, 0.15]], 22, 0.78), M.dress);
  bib.scale.set(1.04, 1, 1.04);
  chest.add(bib);
  // straps over the shoulders
  for (const s of [-1, 1]) {
    const st = mesh(tube([new THREE.Vector3(s * 0.075, 0.1, 0.11), new THREE.Vector3(s * 0.1, 0.2, 0.06), new THREE.Vector3(s * 0.1, 0.21, -0.05), new THREE.Vector3(s * 0.08, 0.1, -0.115)], 0.022, 0.022, 6, 10), M.dress);
    st.scale.set(1, 1, 1);
    chest.add(st);
  }
  // waist sash
  const sash = mesh(new THREE.TorusGeometry(0.145, 0.03, 6, 24), M.dressDark);
  sash.rotation.x = Math.PI / 2;
  sash.scale.set(1, 0.8, 1);
  sash.position.y = -0.2;
  chest.add(sash);
  // red neckerchief: a soft knot and two little tails
  const knot = mesh(new THREE.SphereGeometry(0.045, 10, 8), M.kerchief);
  knot.position.set(0, 0.17, 0.115);
  knot.scale.set(1.2, 0.9, 0.8);
  chest.add(knot);
  const collar = mesh(new THREE.TorusGeometry(0.085, 0.028, 6, 18), M.kerchief);
  collar.rotation.x = Math.PI / 2 - 0.25;
  collar.position.set(0, 0.215, 0.01);
  chest.add(collar);
  for (const s of [-1, 1]) {
    const tail = mesh(new THREE.ConeGeometry(0.04, 0.11, 4, 1), M.kerchief);
    tail.position.set(s * 0.03, 0.11, 0.13);
    tail.rotation.set(Math.PI, 0, s * 0.35);
    tail.scale.set(1, 1, 0.35);
    chest.add(tail);
  }

  // ---------- head ----------
  const neck = new THREE.Group();
  neck.position.y = 0.215;
  chest.add(neck);
  const neckMesh = mesh(new THREE.CylinderGeometry(0.052, 0.058, 0.09, 12), M.skin);
  neckMesh.position.y = 0.03;
  neck.add(neckMesh);
  const head = new THREE.Group();
  head.position.y = 0.055;
  neck.add(head);
  // skull + soft jaw: a sphere pulled into a rounded chin
  const skullGeo = new THREE.SphereGeometry(0.155, 28, 22);
  {
    const p = skullGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (y < 0) { const k = -y / 0.155; x *= 1 - 0.22 * k * k; z *= 1 - 0.1 * k; y *= 1.05; }
      z *= 0.95;
      p.setXYZ(i, x, y, z);
    }
    skullGeo.computeVertexNormals();
  }
  const skull = mesh(skullGeo, M.skin);
  skull.position.y = 0.15;
  head.add(skull);
  // face (+Z): big gentle eyes with highlights, cheeks, tiny nose and mouth
  const eyes: THREE.Mesh[] = [];
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), M.eye);
    eye.scale.set(0.8, 1.2, 0.35);
    eye.position.set(s * 0.054, 0.136, 0.146);
    eye.rotation.y = s * 0.32;
    head.add(eye);
    eyes.push(eye);
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.0095, 8, 6), M.white);
    hl.position.set(s * 0.054 + 0.01, 0.153, 0.156);
    head.add(hl);
    eyes.push(hl);
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.024, 10, 8), M.cheek);
    cheek.scale.set(1.3, 0.7, 0.3);
    cheek.position.set(s * 0.083, 0.097, 0.132);
    cheek.rotation.y = s * 0.55;
    head.add(cheek);
    const brow = new THREE.Mesh(new THREE.CapsuleGeometry(0.006, 0.03, 2, 6), M.eye);
    brow.rotation.z = Math.PI / 2 + s * 0.12;
    brow.position.set(s * 0.056, 0.188, 0.142);
    head.add(brow);
  }
  const nose = mesh(new THREE.SphereGeometry(0.012, 8, 6), M.skin, false);
  nose.position.set(0, 0.112, 0.141);
  head.add(nose);
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.004, 4, 10, Math.PI), M.eye);
  mouth.rotation.z = Math.PI;
  mouth.position.set(0, 0.076, 0.133);
  head.add(mouth);
  for (const s of [-1, 1]) {
    const ear = mesh(new THREE.SphereGeometry(0.025, 8, 6), M.skin);
    ear.scale.set(0.5, 1, 0.8);
    ear.position.set(s * 0.152, 0.13, 0.0);
    head.add(ear);
  }

  // ---------- hair: a rounded bob cap + hand-placed tapered locks ----------
  const cap = mesh(new THREE.SphereGeometry(0.168, 26, 14, 0, Math.PI * 2, 0, Math.PI * 0.38), M.hair);
  cap.position.set(0, 0.162, -0.006);
  cap.scale.set(1.02, 1.0, 1.02);
  head.add(cap);
  // back of the bob: phi PI..2PI is the -Z half (behind the face)
  const back = mesh(new THREE.SphereGeometry(0.17, 24, 16, Math.PI * 1.08, Math.PI * 0.84, 0, Math.PI * 0.66), M.hair);
  back.position.set(0, 0.162, -0.01);
  back.scale.set(1.03, 1.0, 1.05);
  head.add(back);
  const lock = (pts: [number, number, number][], r0: number, mat: THREE.Material, parent: THREE.Object3D = head) => {
    const m = mesh(tube(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z)), r0, 0.004, 7, 10), mat);
    parent.add(m);
    return m;
  };
  // fringe: uneven locks sweeping across the forehead
  const fringe: [number, number, number][][] = [
    [[-0.115, 0.232, 0.1], [-0.112, 0.215, 0.132], [-0.104, 0.19, 0.142]],
    [[-0.065, 0.236, 0.115], [-0.058, 0.222, 0.147], [-0.048, 0.205, 0.155]],
    [[-0.015, 0.238, 0.12], [-0.006, 0.225, 0.152], [0.006, 0.21, 0.158]],
    [[0.04, 0.236, 0.117], [0.05, 0.222, 0.149], [0.062, 0.204, 0.155]],
    [[0.09, 0.232, 0.104], [0.1, 0.214, 0.135], [0.11, 0.19, 0.143]],
  ];
  fringe.forEach((f, i) => lock(f, 0.026, i % 2 ? M.hairLight : M.hair));
  // side and back locks: the bob, flicking out slightly at the jaw
  const hairBack = new THREE.Group();
  head.add(hairBack);
  for (let i = 0; i < 11; i++) {
    const a = Math.PI * 0.4 + (i / 10) * Math.PI * 1.2; // sides + back; the face stays open
    const x = Math.sin(a), z = Math.cos(a);
    const len = 0.2 + (i % 3) * 0.02;
    lock([
      [x * 0.158, 0.222, z * 0.158 - 0.01],
      [x * 0.18, 0.16, z * 0.18 - 0.01],
      [x * 0.18, 0.28 - len, z * 0.18 - 0.01],
      [x * 0.205, 0.26 - len - 0.02, z * 0.205 - 0.015],
    ], 0.04, i % 3 === 1 ? M.hairLight : M.hair, hairBack);
  }

  // ---------- straw hat ----------
  const hat = new THREE.Group();
  hat.position.set(0, 0.228, -0.012);
  hat.rotation.x = -0.12;
  head.add(hat);
  const brim = mesh(shell([[0.0, 0.17], [0.012, 0.2], [0.012, 0.28], [-0.005, 0.34], [-0.03, 0.375], [-0.036, 0.38], [-0.03, 0.372], [-0.005, 0.338], [0.004, 0.28], [0.004, 0.2], [-0.008, 0.17]], 40), M.straw, false);
  hat.add(brim);
  const crown = mesh(shell([[0.0, 0.165], [0.07, 0.165], [0.11, 0.15], [0.13, 0.12], [0.14, 0.06], [0.142, 0.0001]], 30), M.straw, false);
  hat.add(crown);
  // woven rings on the brim
  for (const r of [0.23, 0.29, 0.35]) {
    const ring = mesh(new THREE.TorusGeometry(r, 0.004, 3, 48), M.strawDark, false);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.012 - (r - 0.23) * 0.25;
    hat.add(ring);
  }
  const band = mesh(new THREE.CylinderGeometry(0.168, 0.168, 0.04, 30, 1, true), M.ribbon);
  band.position.y = 0.028;
  hat.add(band);
  const bow = mesh(new THREE.SphereGeometry(0.03, 10, 8), M.ribbon);
  bow.position.set(0.12, 0.03, -0.12);
  bow.scale.set(1.3, 0.9, 0.7);
  hat.add(bow);
  const ribbons: THREE.Mesh[] = [];
  for (const s of [0, 1]) {
    const rg = new THREE.PlaneGeometry(0.05, 0.3, 1, 6);
    rg.translate(0, -0.15, 0);
    const rb = mesh(rg, M.ribbon);
    rb.position.set(0.125 + s * 0.02, 0.025, -0.13);
    rb.rotation.set(0.4, 0.7 + s * 0.25, 0.15);
    hat.add(rb);
    ribbons.push(rb);
  }

  // ---------- arms ----------
  const arms: CharacterRig['arms'] = [];
  for (const s of [-1, 1]) {
    const upper = new THREE.Group();
    upper.position.set(s * 0.16, 0.17, 0);
    upper.rotation.z = s * 0.12;
    chest.add(upper);
    const sleeve = mesh(shell([[0.02, 0.0001], [0.015, 0.05], [-0.04, 0.062], [-0.12, 0.058], [-0.16, 0.06], [-0.17, 0.0001]], 14), M.blouse);
    upper.add(sleeve);
    const fore = new THREE.Group();
    fore.position.y = -0.2;
    upper.add(fore);
    const forearm = mesh(limb(0.16, 0.038, 0.031), M.skin);
    fore.add(forearm);
    const cuff = mesh(new THREE.TorusGeometry(0.04, 0.012, 5, 14), M.blouse);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.y = -0.005;
    fore.add(cuff);
    // hand: soft palm + three chunky finger groups + thumb, slightly curled (reads well at game distance)
    const hand = new THREE.Group();
    hand.position.y = -0.2;
    hand.rotation.y = -s * 0.5;
    fore.add(hand);
    const palm = mesh(new THREE.SphereGeometry(0.034, 12, 10), M.skin);
    palm.scale.set(0.95, 1.05, 0.62);
    palm.position.y = -0.018;
    hand.add(palm);
    for (let f = 0; f < 3; f++) {
      const fx = (f - 1) * 0.019;
      const fin = mesh(new THREE.CapsuleGeometry(0.0105, 0.03, 3, 6), M.skin);
      fin.position.set(fx, -0.058, 0.006);
      fin.rotation.x = 0.35 + f * 0.05;
      hand.add(fin);
    }
    const thumb = mesh(new THREE.CapsuleGeometry(0.011, 0.024, 3, 6), M.skin);
    thumb.position.set(s * 0.028, -0.03, 0.018);
    thumb.rotation.set(0.5, 0, s * 0.6);
    hand.add(thumb);
    arms.push({ upper, fore });
  }

  // ---------- legs ----------
  const legs: CharacterRig['legs'] = [];
  for (const s of [-1, 1]) {
    const thigh = new THREE.Group();
    thigh.position.set(s * 0.075, -0.06, 0);
    hips.add(thigh);
    thigh.add(mesh(limb(0.33, 0.062, 0.05), M.skin));
    const shin = new THREE.Group();
    shin.position.y = -0.35;
    thigh.add(shin);
    shin.add(mesh(limb(0.3, 0.052, 0.038), M.sock));
    const sockTop = mesh(new THREE.TorusGeometry(0.045, 0.012, 5, 14), M.sock);
    sockTop.rotation.x = Math.PI / 2;
    sockTop.position.y = -0.03;
    shin.add(sockTop);
    const foot = new THREE.Group();
    foot.position.y = -0.33;
    shin.add(foot);
    // round-toed Mary-Jane shoe
    const shoeGeo = new THREE.SphereGeometry(0.06, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62);
    shoeGeo.scale(0.85, 0.75, 1.6);
    const shoe = mesh(shoeGeo, M.shoe);
    shoe.position.set(0, -0.025, 0.035);
    foot.add(shoe);
    const sole = mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.02, 14), M.strap);
    sole.scale.set(1, 1, 1.85);
    sole.position.set(0, -0.034, 0.035);
    foot.add(sole);
    const mj = mesh(new THREE.TorusGeometry(0.046, 0.007, 4, 12, Math.PI), M.shoe);
    mj.position.set(0, 0.0, 0.02);
    mj.rotation.y = Math.PI / 2;
    foot.add(mj);
    legs.push({ thigh, shin, foot });
  }

  // ---------- satchel on the left hip, strap over the right shoulder ----------
  // Parented to the chest: twist keeps its distance from the spine axis, so it never sinks into the skirt.
  const satchel = new THREE.Group();
  satchel.position.set(-0.235, -0.3, 0.06);
  satchel.rotation.order = 'YXZ';
  satchel.rotation.set(-0.33, -1.12, 0); // faces out from the hip, top leaning in with the skirt's flare
  chest.add(satchel);
  const bagGeo = new THREE.BoxGeometry(0.17, 0.14, 0.07, 3, 3, 2);
  {
    const p = bagGeo.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); v.z *= 1 + 0.25 * (1 - Math.abs(v.x / 0.085)) * (1 - Math.abs(v.y / 0.07)); v.x *= 1 - 0.06 * (v.y / 0.07); p.setXYZ(i, v.x, v.y, v.z); }
    bagGeo.computeVertexNormals();
  }
  satchel.add(mesh(bagGeo, M.satchel));
  const flap = mesh(new THREE.BoxGeometry(0.175, 0.075, 0.08), M.strap);
  flap.position.y = 0.035;
  satchel.add(flap);
  const buckle = mesh(new THREE.TorusGeometry(0.013, 0.004, 4, 8), M.straw, false);
  buckle.position.set(0, 0.005, 0.045);
  satchel.add(buckle);
  // strap hugs the body: bag -> waist -> chest -> right shoulder -> back -> bag
  const strap = mesh(tube([
    new THREE.Vector3(-0.222, -0.235, 0.1), new THREE.Vector3(-0.12, -0.15, 0.115), new THREE.Vector3(0.0, -0.02, 0.135),
    new THREE.Vector3(0.09, 0.12, 0.11), new THREE.Vector3(0.125, 0.222, 0.0), new THREE.Vector3(0.09, 0.12, -0.11),
    new THREE.Vector3(0.0, -0.02, -0.135), new THREE.Vector3(-0.14, -0.15, -0.1), new THREE.Vector3(-0.25, -0.235, 0.0),
  ], 0.011, 0.011, 5, 40), M.strap);
  chest.add(strap);

  return { root, hips, spine, chest, head, arms, legs, skirt, ribbons, hairBack, eyes, satchel };
}

/**
 * Procedural animation: idle breathing, blinking, and a walk/run cycle with
 * counter-swinging arms, knee bend, hip bob/sway, torso twist, head stabilisation,
 * forward lean with speed, banking into turns, and ribbons/hair trailing in the wind.
 */
export function animateCharacter(rig: CharacterRig, time: number, speed: number, turnRate: number, dt: number, state: { phase: number; blink: number; lean: number }) {
  const run = Math.min(1, Math.max(0, (speed - 3.8) / 2.4));
  const moving = Math.min(1, speed / 1.2);
  // stride frequency rises with speed, but stride length does the rest of the work
  state.phase += dt * (speed > 0.05 ? 3.2 + speed * 0.95 : 0);
  const p = state.phase;
  const sw = Math.sin(p), cw = Math.cos(p);
  const stride = (0.55 + 0.25 * run) * moving;

  // legs: hip swing, knee bend on the recovery, foot keeps roughly level
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? 1 : -1;
    const ph = sw * side;
    const leg = rig.legs[i];
    leg.thigh.rotation.x = -ph * stride;
    const recover = Math.max(0, Math.cos(p + (side > 0 ? 0 : Math.PI)));
    leg.shin.rotation.x = (0.15 + recover * (0.9 + run * 0.6)) * moving;
    leg.foot.rotation.x = -leg.thigh.rotation.x - leg.shin.rotation.x * 0.6;
  }
  // arms swing opposite the legs, elbows bend more when running
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? 1 : -1;
    const sx = i === 0 ? -1 : 1; // geometric side (x < 0 is the left arm)
    const a = rig.arms[i];
    a.upper.rotation.x = sw * side * (0.5 + 0.35 * run) * moving;
    a.upper.rotation.z = sx * (0.2 + 0.05 * moving);
    a.fore.rotation.x = -(0.32 + 0.3 * moving + 0.6 * run);
    a.upper.rotation.x += -0.08 * (1 - moving);
  }
  // idle pose: weight on one hip, near hand resting on the satchel strap, gentle head tilt
  const idle = 1 - moving;
  rig.arms[1].upper.rotation.x += -0.35 * idle;
  rig.arms[1].upper.rotation.z += -0.2 * idle;
  rig.arms[1].fore.rotation.x += -0.9 * idle;
  rig.legs[0].thigh.rotation.z = 0.05 * idle;
  rig.legs[1].thigh.rotation.z = -0.03 * idle;
  rig.legs[1].shin.rotation.x += 0.12 * idle;
  // idle breathing / walking bob
  const breathe = Math.sin(time * 1.9) * 0.008 * (1 - moving);
  rig.hips.position.y = 0.78 + Math.abs(cw) * 0.035 * moving - 0.02 * moving + breathe;
  rig.hips.rotation.y = sw * 0.12 * moving;
  rig.hips.rotation.z = cw * 0.04 * moving + 0.045 * (1 - moving);
  rig.spine.rotation.y = -sw * 0.18 * moving;
  state.lean = THREE.MathUtils.damp(state.lean, -turnRate * 0.06 * moving, 6, dt);
  rig.spine.rotation.x = (0.06 + 0.12 * run) * moving;
  rig.root.rotation.z = state.lean;
  rig.chest.scale.setScalar(1 + Math.sin(time * 1.9) * 0.012 * (1 - moving));
  // head counters the body so the gaze stays steady
  rig.head.rotation.y = -rig.spine.rotation.y * 0.7 - rig.hips.rotation.y * 0.5 + Math.sin(time * 0.37) * 0.15 * (1 - moving);
  rig.head.rotation.x = -rig.spine.rotation.x * 0.6 + Math.sin(time * 0.53) * 0.04 * (1 - moving);
  rig.head.rotation.z = -0.09 * (1 - moving) + Math.sin(time * 0.41) * 0.03 * (1 - moving);
  // skirt swishes with the hips
  rig.skirt.rotation.y = -sw * 0.1 * moving;
  rig.skirt.rotation.x = -0.06 * moving - 0.05 * run;
  // hat ribbons and back hair trail with speed + wind
  rig.ribbons.forEach((r, k) => {
    r.rotation.x = 0.4 + speed * 0.12 + Math.sin(time * 5.5 + k) * 0.18;
    r.rotation.z = 0.15 + Math.sin(time * 3.7 + k * 1.7) * 0.15;
  });
  rig.hairBack.rotation.x = -0.03 - speed * 0.012 + Math.sin(p * 2) * 0.02 * moving;
  // blink every few seconds
  state.blink -= dt;
  let eyeY = 1;
  if (state.blink < 0) { eyeY = Math.abs(state.blink) < 0.09 ? 0.12 : 1; if (state.blink < -0.12) state.blink = 2.5 + ((Math.sin(time * 12.9898) * 43758.5453) % 1 + 1) % 1 * 3; }
  rig.eyes.forEach((e, k) => { if (k % 2 === 0) e.scale.y = 1.2 * eyeY; else e.visible = eyeY > 0.5; });
  rig.satchel.rotation.x = Math.sin(p * 2) * 0.08 * moving;
}
