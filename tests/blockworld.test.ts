import { describe, it, expect, beforeEach } from 'vitest';
import { BlockId, getBlockDefinition, isBlockSolid } from '../src/core/types.js';
import {
  createSettingsForMode,
  detectRecommendedQualityMode,
  GRAPHICS_QUALITY_PRESETS
} from '../src/core/gameState.js';
import { Chunk, CHUNK_SIZE_X, CHUNK_SIZE_Y, CHUNK_SIZE_Z } from '../src/world/chunk.js';
import { SEA_LEVEL, WorldGenerator } from '../src/world/worldGenerator.js';
import { BlockRaycast } from '../src/building/blockInteraction.js';
import { MemoryStorageAdapter, WorldStorage } from '../src/persistence/worldStorage.js';
import { getAtlasUvRect } from '../src/engine/proceduralTextures.js';
import * as THREE from 'three';

describe('BlockWorld Core & Ultra Realism Systems', () => {
  let storage: WorldStorage;

  beforeEach(() => {
    storage = new WorldStorage(new MemoryStorageAdapter());
  });

  it('registers expected block definitions and solidity rules', () => {
    expect(getBlockDefinition(BlockId.AIR).solid).toBe(false);
    expect(getBlockDefinition(BlockId.WATER).solid).toBe(false);
    expect(getBlockDefinition(BlockId.TALL_GRASS).solid).toBe(false);
    expect(getBlockDefinition(BlockId.FLOWER).solid).toBe(false);
    expect(getBlockDefinition(BlockId.GRASS).solid).toBe(true);
    expect(getBlockDefinition(BlockId.STONE).solid).toBe(true);
    expect(isBlockSolid(BlockId.STONE)).toBe(true);
    expect(isBlockSolid(BlockId.WATER)).toBe(false);
  });

  it('configures performance, balanced, and ultra quality presets cleanly', () => {
    const perf = createSettingsForMode('performance');
    const bal = createSettingsForMode('balanced');
    const ultra = createSettingsForMode('ultra');

    expect(perf.renderDistance).toBeLessThan(bal.renderDistance);
    expect(bal.renderDistance).toBeLessThan(ultra.renderDistance);
    expect(perf.shadows).toBe(false);
    expect(bal.shadows).toBe(true);
    expect(ultra.shadows).toBe(true);
    expect(GRAPHICS_QUALITY_PRESETS.ultra.shadowMapSize).toBeGreaterThan(
      GRAPHICS_QUALITY_PRESETS.balanced.shadowMapSize
    );
    expect(typeof detectRecommendedQualityMode()).toBe('string');
  });

  it('generates deterministic chunks and biomes from seed', () => {
    const genA = new WorldGenerator('seed-ultra-1');
    const genB = new WorldGenerator('seed-ultra-1');
    const genC = new WorldGenerator('seed-ultra-2');

    const chunkA = genA.generateChunk(0, 0);
    const chunkB = genB.generateChunk(0, 0);
    const chunkC = genC.generateChunk(0, 0);

    expect(Array.from(chunkA.blocks)).toEqual(Array.from(chunkB.blocks));
    expect(Array.from(chunkA.blocks)).not.toEqual(Array.from(chunkC.blocks));

    const spawn = genA.findSafeSpawn(0, 0);
    expect(spawn.y).toBeGreaterThan(SEA_LEVEL);
    expect(isBlockSolid(genA.getBlockAt(Math.floor(spawn.x), Math.floor(spawn.y - 1.1), Math.floor(spawn.z)))).toBe(true);
  });

  it('provides valid UV atlas coordinates within [0, 1] for all block faces', () => {
    const blockIds = [
      BlockId.GRASS,
      BlockId.DIRT,
      BlockId.STONE,
      BlockId.SAND,
      BlockId.WATER,
      BlockId.WOOD,
      BlockId.PLANKS,
      BlockId.COBBLESTONE,
      BlockId.GLASS,
      BlockId.LEAVES,
      BlockId.TALL_GRASS,
      BlockId.FLOWER
    ];
    for (const id of blockIds) {
      for (const face of ['top', 'side', 'bottom'] as const) {
        const uv = getAtlasUvRect(id, face);
        expect(uv.u0).toBeGreaterThanOrEqual(0);
        expect(uv.u1).toBeLessThanOrEqual(1);
        expect(uv.v0).toBeGreaterThanOrEqual(0);
        expect(uv.v1).toBeLessThanOrEqual(1);
        expect(uv.u1).toBeGreaterThan(uv.u0);
        expect(uv.v1).toBeGreaterThan(uv.v0);
      }
    }
  });

  it('performs raycast hit and adjacent face calculation accurately', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(2, 10, 2, BlockId.STONE);

    const raycast = new BlockRaycast((wx, wy, wz) => {
      if (wx >= 0 && wx < CHUNK_SIZE_X && wz >= 0 && wz < CHUNK_SIZE_Z && wy >= 0 && wy < CHUNK_SIZE_Y) {
        return chunk.getBlock(wx, wy, wz);
      }
      return BlockId.AIR;
    });

    const hit = raycast.cast(new THREE.Vector3(2.5, 10.5, 5.0), new THREE.Vector3(0, 0, -1), 10);
    expect(hit).not.toBeNull();
    expect(hit?.blockPos).toEqual({ x: 2, y: 10, z: 2 });
    expect(hit?.adjacentPos).toEqual({ x: 2, y: 10, z: 3 });
  });

  it('persists and reloads world saves without losing modified chunks', () => {
    const gen = new WorldGenerator('persist-seed');
    const saved = storage.createNewWorld('Mundo Teste', 'persist-seed', gen.findSafeSpawn(0, 0));
    saved.modifiedChunks.push({
      cx: 0,
      cz: 0,
      blocks: Array.from(gen.generateChunk(0, 0).blocks)
    });
    storage.saveWorld(saved);

    const list = storage.listWorlds();
    expect(list.length).toBe(1);
    const loaded = storage.loadWorld(saved.meta.id);
    expect(loaded?.meta.name).toBe('Mundo Teste');
    expect(loaded?.modifiedChunks.length).toBe(1);
  });
});
