import { describe, it, expect, beforeEach } from 'vitest';
import { BlockId, getBlockDefinition, isBlockSolid } from '../src/core/types.js';
import { Chunk, CHUNK_SIZE_X, CHUNK_SIZE_Y, CHUNK_SIZE_Z } from '../src/world/chunk.js';
import { SEA_LEVEL, WorldGenerator } from '../src/world/worldGenerator.js';
import { BlockRaycast } from '../src/building/blockInteraction.js';
import { MemoryStorageAdapter, WorldStorage } from '../src/persistence/worldStorage.js';
import { getBlockFaceUvRect } from '../src/world/blockTextureAtlas.js';
import { buildChunkGeometry } from '../src/world/chunkMeshBuilder.js';
import * as THREE from 'three';

describe('BlockWorld Core Systems', () => {
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

  it('generates deterministic chunks and safe spawn above sea level', () => {
    const genA = new WorldGenerator('seed-alpha');
    const genB = new WorldGenerator('seed-alpha');
    const genC = new WorldGenerator('seed-beta');

    const chunkA = genA.generateChunk(0, 0);
    const chunkB = genB.generateChunk(0, 0);
    const chunkC = genC.generateChunk(0, 0);

    expect(Array.from(chunkA.blocks)).toEqual(Array.from(chunkB.blocks));
    expect(Array.from(chunkA.blocks)).not.toEqual(Array.from(chunkC.blocks));

    const spawn = genA.findSafeSpawn(0, 0);
    expect(spawn.y).toBeGreaterThan(SEA_LEVEL);
    expect(isBlockSolid(genA.getBlockAt(Math.floor(spawn.x), Math.floor(spawn.y - 1.1), Math.floor(spawn.z)))).toBe(true);
  });

  it('computes valid atlas UV rectangles for top, side, and bottom faces', () => {
    const idsToCheck = [
      BlockId.GRASS,
      BlockId.DIRT,
      BlockId.STONE,
      BlockId.SAND,
      BlockId.WOOD,
      BlockId.PLANKS,
      BlockId.COBBLESTONE,
      BlockId.WATER,
      BlockId.GLASS,
      BlockId.LEAVES,
      BlockId.TALL_GRASS,
      BlockId.FLOWER
    ];

    for (const id of idsToCheck) {
      for (const faceKind of ['top', 'side', 'bottom'] as const) {
        const uv = getBlockFaceUvRect(id, faceKind);
        expect(uv.u0).toBeGreaterThanOrEqual(0);
        expect(uv.u1).toBeLessThanOrEqual(1);
        expect(uv.v0).toBeGreaterThanOrEqual(0);
        expect(uv.v1).toBeLessThanOrEqual(1);
        expect(uv.u1).toBeGreaterThan(uv.u0);
        expect(uv.v1).toBeGreaterThan(uv.v0);
      }
    }

    // Grama e madeira devem diferenciar topo e lateral no atlas
    expect(getBlockFaceUvRect(BlockId.GRASS, 'top')).not.toEqual(getBlockFaceUvRect(BlockId.GRASS, 'side'));
    expect(getBlockFaceUvRect(BlockId.WOOD, 'top')).not.toEqual(getBlockFaceUvRect(BlockId.WOOD, 'side'));
  });

  it('builds chunk geometry with non-empty position, normal, color, and uv attributes', () => {
    const gen = new WorldGenerator('atlas-uv-check');
    const chunk = gen.generateChunk(0, 0);
    const geometry = buildChunkGeometry(chunk, (wx, wy, wz) => gen.getBlockAt(wx, wy, wz));

    const uvAttr = geometry.getAttribute('uv');
    const posAttr = geometry.getAttribute('position');
    expect(posAttr).toBeDefined();
    expect(uvAttr).toBeDefined();
    expect(posAttr.count).toBeGreaterThan(0);
    expect(uvAttr.count).toBe(posAttr.count);
    geometry.dispose();
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
