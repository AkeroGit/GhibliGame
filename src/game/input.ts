import * as THREE from 'three';

export interface InputState {
  move: THREE.Vector2;
  look: THREE.Vector2;
  interactPressed: boolean;
  sprint: boolean;
  resetCamera: boolean;
}

/** Keyboard, pointer and touch input. Pointer-look is intentionally opt-in via pointer lock. */
export class InputController {
  readonly state: InputState = {
    move: new THREE.Vector2(),
    look: new THREE.Vector2(),
    interactPressed: false,
    sprint: false,
    resetCamera: false,
  };
  private readonly keys = new Set<string>();
  private readonly element: HTMLElement;
  private pointerLocked = false;
  private touchId: number | null = null;
  private touchStart = new THREE.Vector2();
  private touchCurrent = new THREE.Vector2();
  private onLockChange = () => { this.pointerLocked = document.pointerLockElement === this.element; };

  constructor(element: HTMLElement) {
    this.element = element;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('pointerlockchange', this.onLockChange);
    element.addEventListener('click', this.onClick);
    element.addEventListener('mousemove', this.onMouseMove);
    element.addEventListener('touchstart', this.onTouchStart, { passive: false });
    element.addEventListener('touchmove', this.onTouchMove, { passive: false });
    element.addEventListener('touchend', this.onTouchEnd, { passive: false });
  }

  private onKeyDown = (e: KeyboardEvent) => {
    this.keys.add(e.code);
    if (['Space', 'KeyE', 'KeyR'].includes(e.code)) e.preventDefault();
    if (e.code === 'KeyE' || e.code === 'Space') this.state.interactPressed = true;
    if (e.code === 'KeyR') this.state.resetCamera = true;
  };
  private onKeyUp = (e: KeyboardEvent) => { this.keys.delete(e.code); };
  private onClick = () => {
    if (!this.pointerLocked && document.pointerLockElement !== this.element) this.element.requestPointerLock?.();
  };
  private onMouseMove = (e: MouseEvent) => {
    if (!this.pointerLocked) return;
    this.state.look.x += e.movementX;
    this.state.look.y += e.movementY;
  };
  private onTouchStart = (e: TouchEvent) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    if (!t) return;
    this.touchId = t.identifier;
    this.touchStart.set(t.clientX, t.clientY);
    this.touchCurrent.copy(this.touchStart);
  };
  private onTouchMove = (e: TouchEvent) => {
    e.preventDefault();
    if (this.touchId === null) return;
    for (const t of Array.from(e.changedTouches)) if (t.identifier === this.touchId) this.touchCurrent.set(t.clientX, t.clientY);
  };
  private onTouchEnd = (e: TouchEvent) => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) if (t.identifier === this.touchId) {
      this.touchId = null;
      if (this.touchStart.distanceTo(this.touchCurrent) < 18) this.state.interactPressed = true;
    }
  };

  update() {
    const x = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
    const z = (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0) - (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0);
    this.state.move.set(x, z);
    if (this.state.move.lengthSq() > 1) this.state.move.normalize();
    if (this.touchId !== null) {
      const dx = (this.touchCurrent.x - this.touchStart.x) / 80;
      const dy = (this.touchCurrent.y - this.touchStart.y) / 80;
      this.state.move.set(dx, dy).clampLength(0, 1);
    }
    this.state.sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  consumeInteract() { const v = this.state.interactPressed; this.state.interactPressed = false; return v; }
  consumeResetCamera() { const v = this.state.resetCamera; this.state.resetCamera = false; return v; }

  destroy() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    this.element.removeEventListener('click', this.onClick);
    this.element.removeEventListener('mousemove', this.onMouseMove);
    this.element.removeEventListener('touchstart', this.onTouchStart);
    this.element.removeEventListener('touchmove', this.onTouchMove);
    this.element.removeEventListener('touchend', this.onTouchEnd);
  }
}
