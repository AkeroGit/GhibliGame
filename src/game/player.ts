import * as THREE from 'three';
import { heightAt, slopeAt } from '../world/terrain';
import { InputController } from './input';
import { toon } from '../render/toon';
import { clamp } from '../lib/noise';

/** Small original player model: coat, scarf, satchel, boots and a soft squash-and-stretch walk cycle. */
export function createPlayer() {
  const root = new THREE.Group();
  const model = new THREE.Group();
  root.add(model);
  const skin = toon({ color: '#e9b18d', rim: 0.3 });
  const coat = toon({ color: '#6b7fae', rim: 0.35 });
  const scarfMat = toon({ color: '#d56b55', rim: 0.4, sway: 0.28, swayHeight: 2 });
  const dark = toon({ color: '#3f3d50', rim: 0.2 });
  const hair = toon({ color: '#3f3140', rim: 0.25 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.82, 5, 10), coat);
  body.position.y = 1.05;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), skin);
  head.position.y = 1.78;
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.36, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.58), hair);
  hairCap.position.y = 1.9;
  const bangs = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.28, 8), hair);
  bangs.position.set(0, 1.72, 0.27);
  bangs.rotation.x = Math.PI / 2;
  const scarf = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.14, 0.15), scarfMat);
  scarf.position.set(0, 1.44, 0.05);
  const scarfTail = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.95, 1, 4), scarfMat);
  scarfTail.position.set(-0.35, 1.08, -0.05);
  scarfTail.rotation.y = 0.15;

  const legParts: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.42, 4, 8), dark);
    leg.position.set(side * 0.17, 0.47, 0);
    model.add(leg);
    legParts.push(leg);
    const boot = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), dark);
    boot.scale.set(1, 0.65, 1.35);
    boot.position.set(side * 0.17, 0.18, 0.08);
    model.add(boot);
  }
  const satchel = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.42, 0.18), toon({ color: '#9a6545', rim: 0.2 }));
  satchel.position.set(-0.42, 0.98, -0.12);
  satchel.rotation.z = -0.16;
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.025, 5, 24, Math.PI), toon({ color: '#704936', rim: 0.15 }));
  strap.position.set(-0.12, 1.2, -0.05);
  strap.rotation.set(Math.PI / 2, 0, 0.4);

  model.add(body, head, hairCap, bangs, scarf, scarfTail, satchel, strap);
  for (const child of model.children) { if ('castShadow' in child) { (child as THREE.Mesh).castShadow = true; (child as THREE.Mesh).receiveShadow = true; } }
  root.userData.parts = { model, scarfTail, legs: legParts, body };

  return {
    root,
    position: root.position,
    velocity: new THREE.Vector3(),
    heading: 0,
    speed: 0,
    update(input: InputController, dt: number, cameraYaw: number, time: number) {
      input.update();
      const s = input.state;
      const desired = new THREE.Vector3(s.move.x, 0, s.move.y);
      desired.applyAxisAngle(new THREE.Vector3(0, 1, 0), cameraYaw);
      if (desired.lengthSq() > 0.001) {
        const maxSpeed = s.sprint ? 6.2 : 3.6;
        const target = desired.multiplyScalar(maxSpeed);
        this.velocity.lerp(target, 1 - Math.exp(-dt * 12));
        this.heading = Math.atan2(this.velocity.x, this.velocity.z);
      } else {
        this.velocity.lerp(new THREE.Vector3(), 1 - Math.exp(-dt * 15));
      }
      const next = this.position.clone().addScaledVector(this.velocity, dt);
      const edge = 106;
      next.x = clamp(next.x, -edge, edge); next.z = clamp(next.z, -edge, edge);
      // avoid walking into steep rock faces / water; stay on the playable meadow
      const slope = slopeAt(next.x, next.z);
      if (heightAt(next.x, next.z) < 0.15 || slope > 1.15) this.velocity.multiplyScalar(0.05);
      else this.position.copy(next);
      this.position.y = heightAt(this.position.x, this.position.z) + 0.02;
      this.speed = this.velocity.length();
      root.rotation.y = THREE.MathUtils.damp(root.rotation.y, this.heading, 11, dt);

      const walk = this.speed > 0.15 ? Math.sin(time * (6 + this.speed)) : 0;
      legParts[0].rotation.x = walk * 0.42; legParts[1].rotation.x = -walk * 0.42;
      model.position.y = Math.abs(walk) * 0.025;
      scarfTail.rotation.x = 0.15 + Math.sin(time * 4.5) * 0.12 + this.speed * 0.03;
      scarfTail.rotation.z = -0.2 + Math.sin(time * 3.2) * 0.08;
    },
  };
}

export interface FollowCamera {
  camera: THREE.PerspectiveCamera;
  yaw: number;
  pitch: number;
  update(player: THREE.Object3D, input: InputController, dt: number): void;
  reset(player: THREE.Object3D): void;
}

/** Camera from behind: shoulder-height framing, collision-free spring, mouse/touch orbit. */
export function createFollowCamera(camera: THREE.PerspectiveCamera): FollowCamera {
  const target = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const look = new THREE.Vector3();
  const state: FollowCamera = {
    camera, yaw: 0, pitch: 0.28,
    update(player, input, dt) {
      this.yaw -= input.state.look.x * 0.0025;
      this.pitch = clamp(this.pitch - input.state.look.y * 0.002, -0.15, 0.85);
      input.state.look.set(0, 0);
      target.copy(player.position).add(new THREE.Vector3(0, 1.15, 0));
      const dist = 6.6;
      desired.set(
        Math.sin(this.yaw) * Math.cos(this.pitch) * dist,
        Math.sin(this.pitch) * dist + 1.6,
        Math.cos(this.yaw) * Math.cos(this.pitch) * dist,
      ).add(target);
      camera.position.lerp(desired, 1 - Math.exp(-dt * 9));
      look.copy(target).add(new THREE.Vector3(0, 0.2, 0));
      camera.lookAt(look);
    },
    reset(player) {
      this.yaw = player.rotation.y;
      this.pitch = 0.28;
    },
  };
  return state;
}
