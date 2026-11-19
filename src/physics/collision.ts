import { PlayerPosition, PlayerVelocity } from '../core/gameState.js';
import { GRAVITY, JUMP_VELOCITY, SPRINT_SPEED, WALK_SPEED, WORLD_HEIGHT } from '../core/types.js';

export interface SolidWorldQuery {
  isSolidAt(wx: number, wy: number, wz: number): boolean;
}

export interface PlayerInputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  sprint: boolean;
}

export interface AABB {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export const PLAYER_HALF_WIDTH = 0.32;
export const PLAYER_HEIGHT = 1.75;
export const PLAYER_EYE_OFFSET = 1.58;

export function createPlayerAABB(pos: PlayerPosition): AABB {
  return {
    minX: pos.x - PLAYER_HALF_WIDTH,
    maxX: pos.x + PLAYER_HALF_WIDTH,
    minY: pos.y,
    maxY: pos.y + PLAYER_HEIGHT,
    minZ: pos.z - PLAYER_HALF_WIDTH,
    maxZ: pos.z + PLAYER_HALF_WIDTH
  };
}

export function intersectsAABB(a: AABB, b: AABB): boolean {
  return (
    a.minX < b.maxX &&
    a.maxX > b.minX &&
    a.minY < b.maxY &&
    a.maxY > b.minY &&
    a.minZ < b.maxZ &&
    a.maxZ > b.minZ
  );
}

export function blockIntersectsAABB(bx: number, by: number, bz: number, box: AABB): boolean {
  const blockBox: AABB = {
    minX: bx,
    maxX: bx + 1,
    minY: by,
    maxY: by + 1,
    minZ: bz,
    maxZ: bz + 1
  };
  return intersectsAABB(box, blockBox);
}

export function collidesWithWorld(box: AABB, world: SolidWorldQuery): boolean {
  const minX = Math.floor(box.minX);
  const maxX = Math.floor(box.maxX - 1e-6);
  const minY = Math.floor(box.minY);
  const maxY = Math.floor(box.maxY - 1e-6);
  const minZ = Math.floor(box.minZ);
  const maxZ = Math.floor(box.maxZ - 1e-6);

  for (let y = minY; y <= maxY; y++) {
    if (y < 0 || y >= WORLD_HEIGHT) {
      if (y < 0) return true;
      continue;
    }
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        if (world.isSolidAt(x, y, z)) {
          return true;
        }
      }
    }
  }
  return false;
}

export interface StepPhysicsResult {
  position: PlayerPosition;
  velocity: PlayerVelocity;
  grounded: boolean;
}

export function stepPlayerPhysics(
  position: PlayerPosition,
  velocity: PlayerVelocity,
  yaw: number,
  input: PlayerInputState,
  dt: number,
  world: SolidWorldQuery
): StepPhysicsResult {
  const clampedDt = Math.min(Math.max(dt, 0), 0.05);

  // Vetor horizontal orientado pelo yaw (0 olha para -Z)
  let moveForward = 0;
  let moveRight = 0;
  if (input.forward) moveForward += 1;
  if (input.backward) moveForward -= 1;
  if (input.right) moveRight += 1;
  if (input.left) moveRight -= 1;

  const forwardX = -Math.sin(yaw);
  const forwardZ = -Math.cos(yaw);
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);

  let wishX = forwardX * moveForward + rightX * moveRight;
  let wishZ = forwardZ * moveForward + rightZ * moveRight;
  const wishLen = Math.hypot(wishX, wishZ);
  if (wishLen > 0) {
    wishX /= wishLen;
    wishZ /= wishLen;
  }

  const speed = input.sprint && input.forward ? SPRINT_SPEED : WALK_SPEED;
  const nextVel: PlayerVelocity = {
    x: wishX * speed,
    y: velocity.y - GRAVITY * clampedDt,
    z: wishZ * speed
  };

  let grounded = false;
  // Verifica se está apoiado no chão imediatamente abaixo
  const groundProbe: AABB = {
    minX: position.x - PLAYER_HALF_WIDTH + 0.02,
    maxX: position.x + PLAYER_HALF_WIDTH - 0.02,
    minY: position.y - 0.06,
    maxY: position.y,
    minZ: position.z - PLAYER_HALF_WIDTH + 0.02,
    maxZ: position.z + PLAYER_HALF_WIDTH - 0.02
  };
  if (collidesWithWorld(groundProbe, world) && nextVel.y <= 0) {
    grounded = true;
  }

  if (input.jump && grounded) {
    nextVel.y = JUMP_VELOCITY;
    grounded = false;
  }

  const nextPos: PlayerPosition = {
    x: position.x,
    y: position.y,
    z: position.z
  };

  // Resolução por eixo: X
  const dx = nextVel.x * clampedDt;
  if (dx !== 0) {
    const candidateX = nextPos.x + dx;
    const boxX = createPlayerAABB({ x: candidateX, y: nextPos.y, z: nextPos.z });
    if (!collidesWithWorld(boxX, world)) {
      nextPos.x = candidateX;
    } else {
      nextVel.x = 0;
    }
  }

  // Resolução por eixo: Z
  const dz = nextVel.z * clampedDt;
  if (dz !== 0) {
    const candidateZ = nextPos.z + dz;
    const boxZ = createPlayerAABB({ x: nextPos.x, y: nextPos.y, z: candidateZ });
    if (!collidesWithWorld(boxZ, world)) {
      nextPos.z = candidateZ;
    } else {
      nextVel.z = 0;
    }
  }

  // Resolução por eixo: Y
  const dy = nextVel.y * clampedDt;
  if (dy !== 0) {
    const candidateY = nextPos.y + dy;
    const boxY = createPlayerAABB({ x: nextPos.x, y: candidateY, z: nextPos.z });
    if (!collidesWithWorld(boxY, world)) {
      nextPos.y = Math.max(0, candidateY);
      grounded = false;
    } else {
      if (dy < 0) {
        // Alinha com o topo do bloco sólido abaixo
        nextPos.y = Math.floor(nextPos.y + dy) + 1;
        grounded = true;
      }
      nextVel.y = 0;
    }
  }

  return {
    position: nextPos,
    velocity: nextVel,
    grounded
  };
}
