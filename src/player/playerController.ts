import * as THREE from 'three';
import { PlayerPosition, PlayerVelocity } from '../core/gameState.js';
import { PLAYER_EYE_OFFSET, PlayerInputState, SolidWorldQuery, stepPlayerPhysics } from '../physics/collision.js';

export class PlayerController {
  public position: PlayerPosition;
  public velocity: PlayerVelocity;
  public yaw = 0;
  public pitch = 0;
  public grounded = false;

  private readonly input: PlayerInputState = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false,
    sprint: false
  };

  private pointerLocked = false;
  private sensitivity = 1.0;

  constructor(spawn: PlayerPosition, yaw = 0, pitch = 0) {
    this.position = { ...spawn };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.yaw = yaw;
    this.pitch = pitch;
  }

  setSensitivity(value: number): void {
    this.sensitivity = Math.max(0.1, Math.min(4.0, value));
  }

  setPointerLocked(locked: boolean): void {
    this.pointerLocked = locked;
    if (!locked) {
      this.resetInputs();
    }
  }

  isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  resetInputs(): void {
    this.input.forward = false;
    this.input.backward = false;
    this.input.left = false;
    this.input.right = false;
    this.input.jump = false;
    this.input.sprint = false;
  }

  handleKeyDown(code: string): void {
    switch (code) {
      case 'KeyW':
      case 'ArrowUp':
        this.input.forward = true;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.input.backward = true;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this.input.left = true;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.input.right = true;
        break;
      case 'Space':
        this.input.jump = true;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        this.input.sprint = true;
        break;
    }
  }

  handleKeyUp(code: string): void {
    switch (code) {
      case 'KeyW':
      case 'ArrowUp':
        this.input.forward = false;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.input.backward = false;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this.input.left = false;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.input.right = false;
        break;
      case 'Space':
        this.input.jump = false;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        this.input.sprint = false;
        break;
    }
  }

  handleMouseMove(movementX: number, movementY: number): void {
    if (!this.pointerLocked) return;
    const lookSpeed = 0.0022 * this.sensitivity;
    this.yaw -= movementX * lookSpeed;
    this.pitch -= movementY * lookSpeed;
    const maxPitch = Math.PI / 2 - 0.03;
    this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch));
  }

  update(dt: number, world: SolidWorldQuery, camera: THREE.PerspectiveCamera): void {
    const stepped = stepPlayerPhysics(
      this.position,
      this.velocity,
      this.yaw,
      this.input,
      dt,
      world
    );
    this.position = stepped.position;
    this.velocity = stepped.velocity;
    this.grounded = stepped.grounded;

    camera.position.set(
      this.position.x,
      this.position.y + PLAYER_EYE_OFFSET,
      this.position.z
    );

    const euler = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ');
    camera.quaternion.setFromEuler(euler);
  }

  getLookDirection(): THREE.Vector3 {
    const dir = new THREE.Vector3(0, 0, -1);
    const euler = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ');
    dir.applyEuler(euler).normalize();
    return dir;
  }

  getEyePosition(): THREE.Vector3 {
    return new THREE.Vector3(
      this.position.x,
      this.position.y + PLAYER_EYE_OFFSET,
      this.position.z
    );
  }
}
