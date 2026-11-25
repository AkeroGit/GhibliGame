import * as THREE from 'three';
import { groundAt, heightAt, inBrook, slopeAt } from '../world/terrain';
import { InputController } from './input';
import { createCharacter, animateCharacter } from './character';
import { clamp } from '../lib/noise';

/** Player: the hand-built tea-keeper rig (see character.ts) plus movement on the terrain. */
export function createPlayer() {
  const root = new THREE.Group();
  const rig = createCharacter();
  root.add(rig.root);
  // soft contact shadow: grounds her on grass where the shadow map is too coarse to read
  const blobTex = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const g = cv.getContext('2d')!;
    const grd = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grd.addColorStop(0, 'rgba(40,38,44,0.42)'); grd.addColorStop(0.6, 'rgba(40,38,44,0.18)'); grd.addColorStop(1, 'rgba(40,38,44,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(cv);
  })();
  const blobShadow = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  blobShadow.rotation.x = -Math.PI / 2;
  blobShadow.position.y = 0.03;
  blobShadow.scale.set(1, 0.8, 1);
  root.add(blobShadow);
  const anim = { phase: 0, blink: 2, lean: 0 };
  let lastHeading = 0;
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
      const onDeck = groundAt(next.x, next.z) > heightAt(next.x, next.z) + 0.05;
      if (!onDeck && (heightAt(next.x, next.z) < 0.15 || slope > 1.15 || inBrook(next.x, next.z))) this.velocity.multiplyScalar(0.05);
      else this.position.copy(next);
      this.position.y = groundAt(this.position.x, this.position.z) + 0.02;
      this.speed = this.velocity.length();
      root.rotation.y = THREE.MathUtils.damp(root.rotation.y, this.heading, 11, dt);

      const turnRate = THREE.MathUtils.euclideanModulo(this.heading - lastHeading + Math.PI, Math.PI * 2) - Math.PI;
      lastHeading = this.heading;
      animateCharacter(rig, time, this.speed, dt > 0 ? turnRate / dt : 0, dt, anim);
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
