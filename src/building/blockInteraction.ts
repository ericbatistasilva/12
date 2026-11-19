import {
  BlockId,
  REACH_DISTANCE,
  WORLD_HEIGHT,
  getBlockDefinition
} from '../core/types.js';
import { PlayerPosition, createPlayerAABB, intersectsAABB } from '../physics/collision.js';

export interface TargetBlockHit {
  blockPos: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
  adjacentPos: { x: number; y: number; z: number };
  blockId: number;
  distance: number;
}

export interface VoxelWorldAccess {
  getBlockAt(wx: number, wy: number, wz: number): number;
  setBlockAt(wx: number, wy: number, wz: number, blockId: number): boolean;
}

export interface InventoryAccess {
  getSelectedBlockId(): number;
  getCount(blockId: number): number;
  addItem(blockId: number, amount?: number): boolean;
  consumeItem(blockId: number, amount?: number): boolean;
}

export interface InteractionFeedback {
  ok: boolean;
  action: 'mine' | 'place' | 'none';
  blockId?: number;
  dropId?: number | null;
  reason?: string;
}

/**
 * Algoritmo DDA (Amanatides & Woo) sobre a grade unitária de voxels.
 * Retorna o primeiro bloco não-AR (e não-ÁGUA) atingido dentro do alcance máximo.
 */
export function raycastBlocks(
  origin: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number },
  world: Pick<VoxelWorldAccess, 'getBlockAt'>,
  maxDistance = REACH_DISTANCE,
  stepSize = 0.05
): TargetBlockHit | null {
  const len = Math.hypot(direction.x, direction.y, direction.z);
  if (len === 0) return null;

  const dx = direction.x / len;
  const dy = direction.y / len;
  const dz = direction.z / len;

  let prevX = Math.floor(origin.x);
  let prevY = Math.floor(origin.y);
  let prevZ = Math.floor(origin.z);

  let lastNormal = { x: 0, y: 1, z: 0 };

  for (let dist = stepSize; dist <= maxDistance; dist += stepSize) {
    const px = origin.x + dx * dist;
    const py = origin.y + dy * dist;
    const pz = origin.z + dz * dist;

    const bx = Math.floor(px);
    const by = Math.floor(py);
    const bz = Math.floor(pz);

    if (bx !== prevX || by !== prevY || bz !== prevZ) {
      if (bx !== prevX) {
        lastNormal = { x: bx > prevX ? -1 : 1, y: 0, z: 0 };
      } else if (by !== prevY) {
        lastNormal = { x: 0, y: by > prevY ? -1 : 1, z: 0 };
      } else if (bz !== prevZ) {
        lastNormal = { x: 0, y: 0, z: bz > prevZ ? -1 : 1 };
      }
      prevX = bx;
      prevY = by;
      prevZ = bz;
    }

    if (by < 0 || by >= WORLD_HEIGHT) {
      continue;
    }

    const blockId = world.getBlockAt(bx, by, bz);
    if (blockId !== BlockId.AIR && blockId !== BlockId.WATER) {
      return {
        blockPos: { x: bx, y: by, z: bz },
        normal: { ...lastNormal },
        adjacentPos: {
          x: bx + lastNormal.x,
          y: by + lastNormal.y,
          z: bz + lastNormal.z
        },
        blockId,
        distance: dist
      };
    }
  }

  return null;
}

export function mineTargetedBlock(
  target: TargetBlockHit | null,
  world: VoxelWorldAccess,
  inventory: InventoryAccess
): InteractionFeedback {
  if (!target) {
    return { ok: false, action: 'mine', reason: 'Nenhum bloco ao alcance' };
  }

  const currentBlock = world.getBlockAt(target.blockPos.x, target.blockPos.y, target.blockPos.z);
  if (currentBlock === BlockId.AIR || currentBlock === BlockId.WATER) {
    return { ok: false, action: 'mine', reason: 'Bloco vazio' };
  }

  const changed = world.setBlockAt(target.blockPos.x, target.blockPos.y, target.blockPos.z, BlockId.AIR);
  if (!changed) {
    return { ok: false, action: 'mine', reason: 'Falha ao remover bloco' };
  }

  const def = getBlockDefinition(currentBlock);
  const dropId = def.dropId;
  if (dropId !== null) {
    inventory.addItem(dropId, 1);
  }

  return {
    ok: true,
    action: 'mine',
    blockId: currentBlock,
    dropId
  };
}

export function placeBlockAtTarget(
  target: TargetBlockHit | null,
  playerPos: PlayerPosition,
  world: VoxelWorldAccess,
  inventory: InventoryAccess
): InteractionFeedback {
  if (!target) {
    return { ok: false, action: 'place', reason: 'Nenhuma superfície selecionada' };
  }

  const selectedId = inventory.getSelectedBlockId();
  if (!selectedId || selectedId === BlockId.AIR) {
    return { ok: false, action: 'place', reason: 'Nenhum bloco selecionado' };
  }

  if (inventory.getCount(selectedId) <= 0) {
    return {
      ok: false,
      action: 'place',
      blockId: selectedId,
      reason: `Sem ${getBlockDefinition(selectedId).name} no inventário`
    };
  }

  const { x: ax, y: ay, z: az } = target.adjacentPos;
  if (ay < 0 || ay >= WORLD_HEIGHT) {
    return { ok: false, action: 'place', reason: 'Limite vertical do mundo' };
  }

  const existingAtAdjacent = world.getBlockAt(ax, ay, az);
  if (existingAtAdjacent !== BlockId.AIR && existingAtAdjacent !== BlockId.WATER) {
    return { ok: false, action: 'place', reason: 'Espaço ocupado' };
  }

  const def = getBlockDefinition(selectedId);
  if (def.solid) {
    const playerBox = createPlayerAABB(playerPos);
    const blockBox = {
      minX: ax,
      maxX: ax + 1,
      minY: ay,
      maxY: ay + 1,
      minZ: az,
      maxZ: az + 1
    };
    if (intersectsAABB(playerBox, blockBox)) {
      return { ok: false, action: 'place', reason: 'Bloqueia o jogador' };
    }
  }

  if (!inventory.consumeItem(selectedId, 1)) {
    return { ok: false, action: 'place', reason: 'Recurso insuficiente' };
  }

  const placed = world.setBlockAt(ax, ay, az, selectedId);
  if (!placed) {
    inventory.addItem(selectedId, 1);
    return { ok: false, action: 'place', reason: 'Falha ao posicionar bloco' };
  }

  return {
    ok: true,
    action: 'place',
    blockId: selectedId
  };
}
