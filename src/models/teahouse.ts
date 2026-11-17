import * as THREE from 'three';
import { merge, paint, place, tube } from '../lib/geo';
import { toon } from '../render/toon';

/**
 * Kettle Hill tea house — a small irimoya-roofed teahouse:
 *   stone foundation, dark timber frame, plaster + shoji walls, a wraparound engawa veranda,
 *   curved tiled roof with upturned eaves, ridge ornaments, a noren curtain at the door,
 *   chimney for the kettle stove, lanterns, benches, potted herbs and a stepping-stone approach.
 * Origin = centre of the floor at ground level. Front faces +Z (towards the path).
 */

const COL = {
  stone: '#9a958a', stoneDark: '#77736b',
  timber: '#5a3a28', timberLight: '#7a5236',
  plaster: '#efe4cc', shoji: '#f6efdc', shojiGrid: '#8a6a4a',
  deck: '#9b7450', deckDark: '#7a573a',
  roof: '#4b5f7a', roofDark: '#34445c', roofRidge: '#2c3a4e',
  noren: '#3e6b8a', norenMark: '#f2ead6',
  lanternPaper: '#f4d9a4', lanternRed: '#c4503a',
  pot: '#b5643f', herb: '#5f9a46',
  cushion: '#c96a4f',
};

export interface TeaHouse {
  group: THREE.Group;
  glowMaterials: THREE.MeshToonMaterial[]; // windows + lanterns, brightened at dusk
  lightAnchors: THREE.Vector3[]; // local positions for point lights
  chimneyTop: THREE.Vector3;
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

export function createTeaHouse(): TeaHouse {
  const group = new THREE.Group();
  const solid: THREE.BufferGeometry[] = [];
  const W = 7.2, D = 5.6; // body footprint
  const FLOOR = 0.75; // raised floor height
  const WALL = 2.5;

  // --- foundation stones (irregular, slightly sunk) ---
  for (let i = 0; i < 14; i++) {
    const t = i / 14;
    const per = 2 * (W + D);
    let d = t * per, x = 0, z = 0;
    if (d < W) { x = -W / 2 + d; z = D / 2; }
    else if ((d -= W) < D) { x = W / 2; z = D / 2 - d; }
    else if ((d -= D) < W) { x = W / 2 - d; z = -D / 2; }
    else { d -= W; x = -W / 2; z = -D / 2 + d; }
    const s = new THREE.DodecahedronGeometry(0.42 + (i % 3) * 0.05, 0);
    place(s, x, 0.12, z, i, i * 1.3, 0, [1.1, 0.7, 1.0]);
    solid.push(paint(s, i % 2 ? COL.stone : COL.stoneDark));
  }
  // floor platform
  solid.push(paint(place(box(W + 0.2, 0.22, D + 0.2), 0, FLOOR - 0.11, 0), COL.timber));

  // --- engawa veranda: front and right side, with boards ---
  const deckW = W + 2.4, deckD = 1.6;
  for (let i = 0; i < 12; i++) {
    const bx = -deckW / 2 + (i + 0.5) * (deckW / 12);
    solid.push(paint(place(box(deckW / 12 - 0.04, 0.09, deckD), bx, FLOOR - 0.1, D / 2 + deckD / 2), i % 2 ? COL.deck : COL.deckDark));
  }
  for (let i = 0; i < 8; i++) {
    const bz = -D / 2 + (i + 0.5) * (D / 8);
    solid.push(paint(place(box(1.3, 0.09, D / 8 - 0.04), W / 2 + 0.65 + 0.0, FLOOR - 0.1, bz), i % 2 ? COL.deck : COL.deckDark));
  }
  // deck posts + step stone
  for (const [px, pz] of [[-deckW / 2 + 0.15, D / 2 + deckD - 0.1], [deckW / 2 - 0.15, D / 2 + deckD - 0.1], [W / 2 + 1.2, -D / 2 + 0.1]]) {
    solid.push(paint(place(box(0.16, FLOOR, 0.16), px, FLOOR / 2 - 0.1, pz), COL.timber));
  }
  solid.push(paint(place(new THREE.CylinderGeometry(0.75, 0.85, 0.32, 9), 0, 0.12, D / 2 + deckD + 0.55, 0, 0.3, 0, [1.3, 1, 0.8]), COL.stone));

  // --- frame + walls ---
  const wallY = FLOOR + WALL / 2;
  const posts: [number, number][] = [];
  for (const x of [-W / 2, -W / 6, W / 6, W / 2]) posts.push([x, D / 2], [x, -D / 2]);
  for (const z of [-D / 6, D / 6]) posts.push([-W / 2, z], [W / 2, z]);
  for (const [px, pz] of posts) solid.push(paint(place(box(0.2, WALL + 0.25, 0.2), px, wallY + 0.05, pz), COL.timber));
  // sill + head beams
  for (const y of [FLOOR + 0.06, FLOOR + WALL]) {
    solid.push(paint(place(box(W + 0.22, 0.16, 0.18), 0, y, D / 2), COL.timber));
    solid.push(paint(place(box(W + 0.22, 0.16, 0.18), 0, y, -D / 2), COL.timber));
    solid.push(paint(place(box(0.18, 0.16, D + 0.22), W / 2, y, 0), COL.timber));
    solid.push(paint(place(box(0.18, 0.16, D + 0.22), -W / 2, y, 0), COL.timber));
  }
  // plaster: back + left walls fully, upper band elsewhere
  solid.push(paint(place(box(W, WALL, 0.1), 0, wallY, -D / 2), COL.plaster));
  solid.push(paint(place(box(0.1, WALL, D), -W / 2, wallY, 0), COL.plaster));
  solid.push(paint(place(box(W, 0.55, 0.1), 0, FLOOR + WALL - 0.3, D / 2), COL.plaster));
  solid.push(paint(place(box(0.1, 0.55, D), W / 2, FLOOR + WALL - 0.3, 0), COL.plaster));
  // round window on the left wall (tea-room motif)
  solid.push(paint(place(new THREE.TorusGeometry(0.52, 0.07, 6, 20), -W / 2 - 0.06, wallY + 0.15, 0.6, 0, Math.PI / 2, 0), COL.timber));

  // --- shoji screens (glow at night) ---
  const shojiParts: THREE.BufferGeometry[] = [];
  const gridParts: THREE.BufferGeometry[] = [];
  const shojiH = WALL - 0.65;
  const addShoji = (cx: number, cz: number, w: number, alongX: boolean, skip?: (i: number) => boolean) => {
    const panels = Math.round(w / 0.9);
    const pw = w / panels;
    for (let i = 0; i < panels; i++) {
      if (skip?.(i)) continue;
      const o = -w / 2 + (i + 0.5) * pw;
      const x = alongX ? cx + o : cx, z = alongX ? cz : cz + o;
      shojiParts.push(place(box(alongX ? pw - 0.04 : 0.05, shojiH, alongX ? 0.05 : pw - 0.04), x, FLOOR + 0.1 + shojiH / 2, z));
      // lattice: 2 verticals, 4 horizontals
      for (let v = 1; v < 3; v++) {
        const ov = -pw / 2 + (v / 3) * pw;
        gridParts.push(place(box(alongX ? 0.035 : 0.07, shojiH, alongX ? 0.07 : 0.035), alongX ? x + ov : x, FLOOR + 0.1 + shojiH / 2, alongX ? z : z + ov));
      }
      for (let h = 1; h < 5; h++) {
        gridParts.push(place(box(alongX ? pw : 0.07, 0.035, alongX ? 0.07 : pw), x, FLOOR + 0.1 + (h / 5) * shojiH, z));
      }
      // panel frame
      gridParts.push(place(box(alongX ? 0.06 : 0.08, shojiH, alongX ? 0.08 : 0.06), alongX ? x - pw / 2 + 0.03 : x, FLOOR + 0.1 + shojiH / 2, alongX ? z : z - pw / 2 + 0.03));
    }
  };
  // front: leave a doorway in the middle (panels 3,4 of 8)
  addShoji(0, D / 2 + 0.02, W - 0.2, true, (i) => i === 3 || i === 4);
  addShoji(W / 2 + 0.02, 0, D - 0.2, false);
  for (const g of gridParts) solid.push(paint(g, COL.shojiGrid));

  // doorway interior: dark wood floor + warm back
  solid.push(paint(place(box(1.7, shojiH, 0.05), 0, FLOOR + 0.1 + shojiH / 2, D / 2 - 1.2), '#6a4a34'));

  // --- noren curtain (two panels with a white mark) ---
  const noren: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const g = new THREE.PlaneGeometry(0.8, 0.85, 1, 4);
    place(g, s * 0.42, FLOOR + WALL - 0.55, D / 2 + 0.12);
    noren.push(paint(g, COL.noren));
  }
  noren.push(paint(place(new THREE.CircleGeometry(0.17, 14), -0.42, FLOOR + WALL - 0.5, D / 2 + 0.13), COL.norenMark));
  noren.push(paint(place(new THREE.CircleGeometry(0.17, 14), 0.42, FLOOR + WALL - 0.5, D / 2 + 0.13), COL.norenMark));
  solid.push(paint(place(new THREE.CylinderGeometry(0.03, 0.03, 1.9, 6), 0, FLOOR + WALL - 0.12, D / 2 + 0.12, 0, 0, Math.PI / 2), COL.timberLight));

  // --- irimoya roof: hip lower section + gable upper, curved eaves, tile rows ---
  const roofParts: THREE.BufferGeometry[] = [];
  const roofDark: THREE.BufferGeometry[] = [];
  const eaveY = FLOOR + WALL + 0.15;
  const OH = 1.55; // overhang
  const RW = W / 2 + OH + 0.9, RD = D / 2 + OH + 0.4; // include veranda
  const ridgeY = eaveY + 2.6;
  const ridgeHalf = RW * 0.42;
  const curve = (t: number) => Math.pow(t, 1.6); // concave profile -> upturned eaves
  // Build each roof slope as a grid surface.
  const slope = (side: 'front' | 'back' | 'left' | 'right') => {
    const segU = 16, segV = 10;
    const pos: number[] = [];
    const idx: number[] = [];
    for (let v = 0; v <= segV; v++) {
      const tv = v / segV; // 0 eave -> 1 ridge
      const y = eaveY + (ridgeY - eaveY) * curve(tv) + 0.0;
      for (let u = 0; u <= segU; u++) {
        const tu = u / segU * 2 - 1;
        let x = 0, z = 0;
        if (side === 'front' || side === 'back') {
          const half = RW + (ridgeHalf - RW) * tv;
          x = tu * half;
          z = (side === 'front' ? 1 : -1) * (RD * (1 - tv) + 0.02);
          // corner lift: eave corners curl up
          const corner = Math.pow(Math.abs(tu), 6) * (1 - tv);
          pos.push(x, y + corner * 0.75, z + 0.0);
        } else {
          const half = RD * (1 - tv);
          z = tu * half;
          x = (side === 'right' ? 1 : -1) * (RW + (ridgeHalf - RW) * tv);
          const corner = Math.pow(Math.abs(tu), 6) * (1 - tv);
          pos.push(x, y + corner * 0.75, z);
        }
      }
    }
    for (let v = 0; v < segV; v++) for (let u = 0; u < segU; u++) {
      const a = v * (segU + 1) + u, b = a + 1, c = a + segU + 1, d = c + 1;
      if (side === 'front' || side === 'left') idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  for (const s of ['front', 'back', 'left', 'right'] as const) roofParts.push(paint(slope(s), COL.roof));
  // underside (so the eaves aren't see-through from below)
  for (const s of ['front', 'back', 'left', 'right'] as const) {
    const g = slope(s);
    g.translate(0, -0.12, 0);
    const ix = g.index!.array as Uint16Array | Uint32Array;
    for (let i = 0; i < ix.length; i += 3) { const t = ix[i]; ix[i] = ix[i + 1]; ix[i + 1] = t; }
    g.computeVertexNormals();
    roofDark.push(paint(g, COL.timber));
  }
  // tile ridges (rows of rounded battens on front/back)
  for (const zs of [1, -1]) {
    for (let k = -9; k <= 9; k++) {
      const pts: THREE.Vector3[] = [];
      for (let v = 0; v <= 6; v++) {
        const tv = v / 6 * 0.98;
        const half = RW + (ridgeHalf - RW) * tv;
        const tu = k / 10;
        const x = tu * half;
        const corner = Math.pow(Math.abs(tu), 6) * (1 - tv);
        pts.push(new THREE.Vector3(x, eaveY + (ridgeY - eaveY) * curve(tv) + corner * 0.75 + 0.06, zs * (RD * (1 - tv) + 0.04)));
      }
      roofDark.push(paint(tube(pts, 0.07, 0.07, 4, 8), COL.roofDark));
    }
  }
  // eave fascia boards
  for (const zs of [1, -1]) {
    const pts: THREE.Vector3[] = [];
    for (let u = 0; u <= 16; u++) {
      const tu = u / 16 * 2 - 1;
      pts.push(new THREE.Vector3(tu * RW, eaveY + Math.pow(Math.abs(tu), 6) * 0.75 - 0.03, zs * (RD + 0.03)));
    }
    roofDark.push(paint(tube(pts, 0.09, 0.09, 4, 32), COL.roofRidge));
  }
  // gable triangles (upper irimoya part) + main ridge
  const gableY0 = eaveY + (ridgeY - eaveY) * curve(0.55);
  for (const xs of [1, -1]) {
    const x = xs * ridgeHalf * 0.98;
    const g = new THREE.BufferGeometry();
    const zz = RD * (1 - 0.55) * 0.95;
    g.setAttribute('position', new THREE.Float32BufferAttribute([x, gableY0, -zz, x, gableY0, zz, x, ridgeY + 0.05, 0], 3));
    if (xs > 0) g.setIndex([0, 2, 1]); else g.setIndex([0, 1, 2]);
    g.computeVertexNormals();
    solid.push(paint(g, COL.timberLight));
  }
  roofDark.push(paint(place(box(ridgeHalf * 2 + 0.6, 0.32, 0.4), 0, ridgeY + 0.12, 0), COL.roofRidge));
  // ridge end ornaments (onigawara-ish curls)
  for (const xs of [1, -1]) {
    const pts = [
      new THREE.Vector3(xs * (ridgeHalf + 0.2), ridgeY + 0.1, 0),
      new THREE.Vector3(xs * (ridgeHalf + 0.5), ridgeY + 0.45, 0),
      new THREE.Vector3(xs * (ridgeHalf + 0.45), ridgeY + 0.8, 0),
    ];
    roofDark.push(paint(tube(pts, 0.2, 0.08, 6, 6), COL.roofRidge));
  }

  // --- chimney for the kettle stove (back-right) ---
  const chimX = W / 2 - 1.2, chimZ = -D / 2 + 1.0;
  solid.push(paint(place(new THREE.CylinderGeometry(0.32, 0.38, 2.4, 10), chimX, ridgeY - 0.6, chimZ), COL.stoneDark));
  solid.push(paint(place(new THREE.CylinderGeometry(0.44, 0.44, 0.18, 10), chimX, ridgeY + 0.62, chimZ), COL.stone));
  solid.push(paint(place(new THREE.ConeGeometry(0.55, 0.35, 10), chimX, ridgeY + 0.98, chimZ), COL.roofRidge));
  const chimneyTop = new THREE.Vector3(chimX, ridgeY + 0.9, chimZ);

  // --- lanterns (hanging at eave corners + a stone lantern by the path) ---
  const lanternMat = toon({ color: COL.lanternPaper, emissive: '#ffb45a', emissiveIntensity: 0, rim: 0.2 });
  const lanternGeo: THREE.BufferGeometry[] = [];
  const lightAnchors: THREE.Vector3[] = [];
  const hang = (x: number, z: number) => {
    const y = eaveY - 0.25;
    const body = new THREE.SphereGeometry(0.26, 12, 10);
    body.scale(1, 1.25, 1);
    lanternGeo.push(place(body, x, y - 0.55, z));
    solid.push(paint(place(new THREE.CylinderGeometry(0.15, 0.15, 0.08, 10), x, y - 0.22, z), COL.timber));
    solid.push(paint(place(new THREE.CylinderGeometry(0.15, 0.15, 0.08, 10), x, y - 0.88, z), COL.timber));
    solid.push(paint(place(new THREE.CylinderGeometry(0.012, 0.012, 0.25, 4), x, y - 0.1, z), COL.timber));
    lightAnchors.push(new THREE.Vector3(x, y - 0.55, z));
  };
  hang(-W / 2 - 0.4, D / 2 + 1.45);
  hang(W / 2 + 1.0, D / 2 + 1.45);
  // stone lantern (toro) beside the stepping stones
  const tx = -2.6, tz = D / 2 + 3.4;
  solid.push(paint(place(new THREE.CylinderGeometry(0.45, 0.55, 0.25, 6), tx, 0.12, tz), COL.stoneDark));
  solid.push(paint(place(new THREE.CylinderGeometry(0.14, 0.18, 0.9, 8), tx, 0.7, tz), COL.stone));
  solid.push(paint(place(new THREE.CylinderGeometry(0.4, 0.3, 0.16, 6), tx, 1.2, tz), COL.stone));
  lanternGeo.push(place(box(0.42, 0.36, 0.42), tx, 1.47, tz));
  solid.push(paint(place(new THREE.ConeGeometry(0.62, 0.42, 6), tx, 1.86, tz), COL.stoneDark));
  solid.push(paint(place(new THREE.SphereGeometry(0.1, 8, 6), tx, 2.12, tz), COL.stone));
  lightAnchors.push(new THREE.Vector3(tx, 1.47, tz));

  // --- props: bench with cushions, potted herbs, kettle on a little brazier ---
  const bx = 2.4, bz = D / 2 + 2.9;
  solid.push(paint(place(box(2.2, 0.1, 0.62), bx, 0.5, bz), COL.deck));
  for (const s of [-1, 1]) solid.push(paint(place(box(0.12, 0.5, 0.5), bx + s * 0.9, 0.25, bz), COL.timber));
  solid.push(paint(place(new THREE.CapsuleGeometry(0.2, 0.25, 4, 8), bx - 0.45, 0.62, bz, 0, 0, Math.PI / 2, [1, 0.45, 1]), COL.cushion));
  // red parasol (nodate-gasa) over the bench
  solid.push(paint(place(new THREE.CylinderGeometry(0.035, 0.035, 2.6, 6), bx + 1.05, 1.3, bz - 0.15, 0, 0, -0.12), COL.timber));
  const umb = new THREE.ConeGeometry(1.5, 0.55, 18, 1, true);
  solid.push(paint(place(umb, bx + 0.9, 2.55, bz - 0.15, 0, 0, -0.12), COL.lanternRed));
  const umbIn = new THREE.ConeGeometry(1.48, 0.53, 18, 1, true);
  umbIn.scale(-1, 1, 1);
  solid.push(paint(place(umbIn, bx + 0.9, 2.53, bz - 0.15, 0, 0, -0.12), '#a8402e'));
  // pots along the veranda edge
  for (let i = 0; i < 4; i++) {
    const px = -W / 2 + 0.4 + i * 0.55, pz = D / 2 + 1.25;
    solid.push(paint(place(new THREE.CylinderGeometry(0.2, 0.15, 0.32, 9), px, FLOOR + 0.06, pz), COL.pot));
    const herb = new THREE.IcosahedronGeometry(0.26, 1);
    solid.push(paint(place(herb, px, FLOOR + 0.36, pz, i, i, 0, [1, 0.8, 1]), new THREE.Color(COL.herb).offsetHSL(0, 0, (i % 2) * 0.06)));
  }
  // kettle on the veranda
  const kx = W / 2 + 0.6, kz = 0.8;
  solid.push(paint(place(new THREE.CylinderGeometry(0.3, 0.26, 0.34, 10), kx, FLOOR + 0.12, kz), COL.stoneDark));
  solid.push(paint(place(new THREE.SphereGeometry(0.24, 12, 8), kx, FLOOR + 0.46, kz, 0, 0, 0, [1, 0.8, 1]), '#3a3a3e'));
  solid.push(paint(place(new THREE.TorusGeometry(0.16, 0.02, 5, 12, Math.PI), kx, FLOOR + 0.62, kz), '#3a3a3e'));
  solid.push(paint(place(new THREE.CylinderGeometry(0.025, 0.04, 0.22, 5), kx + 0.24, FLOOR + 0.5, kz, 0, 0, -0.9), '#3a3a3e'));

  // --- assemble ---
  const solidMesh = new THREE.Mesh(merge(solid), toon({ vertexColors: true, rim: 0.25 }));
  const roofMesh = new THREE.Mesh(merge(roofParts), toon({ vertexColors: true, rim: 0.35, side: THREE.DoubleSide }));
  const roofDarkMesh = new THREE.Mesh(merge(roofDark), toon({ vertexColors: true, rim: 0.2 }));
  const shojiMat = toon({ color: COL.shoji, emissive: '#ffbf6a', emissiveIntensity: 0, rim: 0.1 });
  const shojiMesh = new THREE.Mesh(merge(shojiParts.map((g) => paint(g, '#ffffff'))), shojiMat);
  const norenMesh = new THREE.Mesh(merge(noren), toon({ vertexColors: true, side: THREE.DoubleSide, sway: 0.25, swayHeight: 4 }));
  const lanternMesh = new THREE.Mesh(merge(lanternGeo.map((g) => paint(g, '#ffffff'))), lanternMat);
  for (const m of [solidMesh, roofMesh, roofDarkMesh, shojiMesh, norenMesh, lanternMesh]) {
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  return { group, glowMaterials: [shojiMat, lanternMat], lightAnchors, chimneyTop };
}
