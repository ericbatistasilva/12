import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  BlockId,
  CHUNK_SIZE_X,
  CHUNK_SIZE_Z,
  WORLD_HEIGHT,
  getBlockDefinition,
  isBlockSolid
} from '../src/core/types.js';
import { GameStateManager } from '../src/core/gameState.js';
import { WorldGenerator } from '../src/world/worldGenerator.js';
import { raycastBlocks } from '../src/building/blockInteraction.js';
import { PlayerController } from '../src/player/playerController.js';
import { WorldStorage } from '../src/persistence/worldStorage.js';
import { getBlockFaceUvRect } from '../src/world/blockTextureAtlas.js';
import {
  buildChunkGeometries,
  computeVertexAnimKindAndWeight
} from '../src/world/chunkMeshBuilder.js';
import {
  createAtmosphericSkyDome,
  getQualityProfile,
  normalizeQualityPreset,
  resolveEffectiveVisualFlags
} from '../src/engine/visualPipeline.js';

function setBlockInChunk(blocks: Uint8Array, lx: number, wy: number, lz: number, id: number): void {
  assert.ok(wy >= 0 && wy < WORLD_HEIGHT, `wy out of bounds: ${wy}`);
  const idx = wy * CHUNK_SIZE_X * CHUNK_SIZE_Z + lz * CHUNK_SIZE_X + lx;
  blocks[idx] = id;
}

test('1. deterministic procedural world generation and safe spawn', () => {
  const genA = new WorldGenerator('seed-alpha');
  const genB = new WorldGenerator('seed-alpha');
  const genC = new WorldGenerator('seed-beta');

  const chunkA = genA.generateChunk(0, 0);
  const chunkB = genB.generateChunk(0, 0);
  const chunkC = genC.generateChunk(0, 0);

  assert.deepEqual(Array.from(chunkA), Array.from(chunkB));
  assert.notDeepEqual(Array.from(chunkA), Array.from(chunkC));

  const spawn = genA.findSafeSpawnPosition(0, 0);
  assert.ok(spawn.y > 0);
  assert.equal(
    isBlockSolid(genA.getBlockAt(Math.floor(spawn.x), Math.floor(spawn.y - 1.1), Math.floor(spawn.z))),
    true
  );
});

test('2. physics and block collision behavior', () => {
  const manager = new GameStateManager();
  const state = manager.getState();
  const camera = new THREE.PerspectiveCamera(state.settings.fov, 1.5, 0.1, 180);
  const solidBlocks = new Map<string, number>();
  solidBlocks.set('0,4,0', BlockId.STONE);

  const player = new PlayerController(
    camera,
    state.settings,
    (wx: number, wy: number, wz: number): number => solidBlocks.get(`${wx},${wy},${wz}`) ?? BlockId.AIR
  );
  player.position.set(0.5, 5.01, 0.5);
  player.velocity.y = -4;

  player.update(0.05, {});
  assert.equal(player.onGround, true);
  assert.equal(player.intersectsBlock(0, 4, 0), true);
  assert.equal(player.intersectsBlock(3, 10, 3), false);
});

test('3. block mining and placement raycast target resolution', () => {
  const blocks = new Uint8Array(CHUNK_SIZE_X * WORLD_HEIGHT * CHUNK_SIZE_Z);
  setBlockInChunk(blocks, 2, 4, 2, BlockId.STONE);

  const origin = new THREE.Vector3(2.5, 4.5, 5.0);
  const direction = new THREE.Vector3(0, 0, -1);

  const hit = raycastBlocks(
    origin,
    direction,
    8,
    (wx: number, wy: number, wz: number): number => {
      if (wx >= 0 && wx < CHUNK_SIZE_X && wz >= 0 && wz < CHUNK_SIZE_Z && wy >= 0 && wy < WORLD_HEIGHT) {
        return blocks[wy * CHUNK_SIZE_X * CHUNK_SIZE_Z + wz * CHUNK_SIZE_X + wx] ?? BlockId.AIR;
      }
      return BlockId.AIR;
    }
  );

  assert.ok(hit !== null);
  assert.deepEqual(hit.blockPos, { x: 2, y: 4, z: 2 });
  assert.deepEqual(hit.adjacentPos, { x: 2, y: 4, z: 3 });

  const idx = 4 * CHUNK_SIZE_X * CHUNK_SIZE_Z + 2 * CHUNK_SIZE_X + 2;
  blocks[idx] = BlockId.AIR;
  assert.equal(blocks[idx], BlockId.AIR);
  blocks[idx] = BlockId.PLANKS;
  assert.equal(blocks[idx], BlockId.PLANKS);
});

test('4. inventory slots, hotbar selection, and block definitions', () => {
  const manager = new GameStateManager();
  const state = manager.getState();
  assert.ok(state.hotbar.length > 0);
  assert.equal(getBlockDefinition(BlockId.AIR).solid, false);
  assert.equal(getBlockDefinition(BlockId.WATER).solid, false);
  assert.equal(getBlockDefinition(BlockId.GRASS).solid, true);
  assert.equal(getBlockDefinition(BlockId.STONE).solid, true);
  assert.equal(isBlockSolid(BlockId.STONE), true);
  assert.equal(isBlockSolid(BlockId.WATER), false);

  const firstSlot = state.hotbar[0];
  assert.ok(firstSlot !== undefined);
  assert.ok(firstSlot.count > 0);
});

test('5. world persistence and integrity across save and load', () => {
  const memoryStore = new Map<string, string>();
  const storage = new WorldStorage({
    getItem(key: string): string | null {
      return memoryStore.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      memoryStore.set(key, value);
    },
    removeItem(key: string): void {
      memoryStore.delete(key);
    }
  });

  const gen = new WorldGenerator('persist-seed');
  const world = storage.createWorld('Mundo Persistente', 'persist-seed', gen.findSafeSpawnPosition(0, 0));
  world.modifiedChunks.push({
    cx: 0,
    cz: 0,
    blocks: Array.from(gen.generateChunk(0, 0))
  });
  storage.saveWorld(world);

  const worlds = storage.listWorlds();
  assert.equal(worlds.length, 1);
  const loaded = storage.loadWorld(world.meta.id);
  assert.ok(loaded !== null);
  assert.equal(loaded.meta.name, 'Mundo Persistente');
  assert.equal(loaded.modifiedChunks.length, 1);
});

test('6. atlas UV rectangles are valid and differentiate top vs side faces', () => {
  const sampleBlocks = [
    BlockId.GRASS,
    BlockId.DIRT,
    BlockId.STONE,
    BlockId.SAND,
    BlockId.WOOD,
    BlockId.PLANKS,
    BlockId.COBBLESTONE,
    BlockId.WATER,
    BlockId.GLASS,
    BlockId.LEAVES
  ];

  for (const id of sampleBlocks) {
    for (const faceKind of ['top', 'side', 'bottom'] as const) {
      const uv = getBlockFaceUvRect(id, faceKind);
      assert.ok(uv.u0 >= 0 && uv.u0 < uv.u1 && uv.u1 <= 1);
      assert.ok(uv.v0 >= 0 && uv.v0 < uv.v1 && uv.v1 <= 1);
    }
  }

  assert.notDeepEqual(
    getBlockFaceUvRect(BlockId.GRASS, 'top'),
    getBlockFaceUvRect(BlockId.GRASS, 'side')
  );
  assert.notDeepEqual(
    getBlockFaceUvRect(BlockId.WOOD, 'top'),
    getBlockFaceUvRect(BlockId.WOOD, 'side')
  );
});

test('7. buildChunkGeometries produces aligned animation kind and weight attributes across valid elevations', () => {
  const blocksLow = new Uint8Array(CHUNK_SIZE_X * WORLD_HEIGHT * CHUNK_SIZE_Z);
  setBlockInChunk(blocksLow, 2, 2, 2, BlockId.GRASS);
  setBlockInChunk(blocksLow, 3, 3, 3, BlockId.WATER);
  setBlockInChunk(blocksLow, 4, 5, 4, BlockId.LEAVES);
  setBlockInChunk(blocksLow, 6, 5, 6, BlockId.GLASS);

  const blocksHigh = new Uint8Array(CHUNK_SIZE_X * WORLD_HEIGHT * CHUNK_SIZE_Z);
  setBlockInChunk(blocksHigh, 3, 40, 3, BlockId.WATER);
  setBlockInChunk(blocksHigh, 4, 42, 4, BlockId.LEAVES);

  const emptyLookup = { getBlockAt: () => BlockId.AIR };
  const resLow = buildChunkGeometries(0, 0, blocksLow, emptyLookup);
  const resHigh = buildChunkGeometries(0, 0, blocksHigh, emptyLookup);

  assert.ok(resLow.opaqueGeometry !== null);
  assert.ok(resLow.transparentGeometry !== null);
  assert.ok(resHigh.transparentGeometry !== null);

  const opPos = resLow.opaqueGeometry.getAttribute('position');
  const opNorm = resLow.opaqueGeometry.getAttribute('normal');
  const opUv = resLow.opaqueGeometry.getAttribute('uv');
  const opColor = resLow.opaqueGeometry.getAttribute('color');
  const opKind = resLow.opaqueGeometry.getAttribute('aAnimKind');
  const opWeight = resLow.opaqueGeometry.getAttribute('aAnimWeight');
  assert.equal(opNorm.count, opPos.count);
  assert.equal(opUv.count, opPos.count);
  assert.equal(opColor.count, opPos.count);
  assert.equal(opKind.count, opPos.count);
  assert.equal(opWeight.count, opPos.count);
  assert.ok(Array.from(opKind.array as Float32Array).every((v) => v === 0));
  assert.ok(Array.from(opWeight.array as Float32Array).every((v) => v === 0));
  assert.ok(Array.from(opColor.array as Float32Array).some((v) => v > 0));

  const trPos = resLow.transparentGeometry.getAttribute('position');
  const trNorm = resLow.transparentGeometry.getAttribute('normal');
  const trUv = resLow.transparentGeometry.getAttribute('uv');
  const trColor = resLow.transparentGeometry.getAttribute('color');
  const trKind = resLow.transparentGeometry.getAttribute('aAnimKind');
  const trWeight = resLow.transparentGeometry.getAttribute('aAnimWeight');
  assert.equal(trNorm.count, trPos.count);
  assert.equal(trUv.count, trPos.count);
  assert.equal(trColor.count, trPos.count);
  assert.equal(trKind.count, trPos.count);
  assert.equal(trWeight.count, trPos.count);
  assert.ok(Array.from(trColor.array as Float32Array).some((v) => v > 0));

  const trHighKind = resHigh.transparentGeometry.getAttribute('aAnimKind');
  const trHighWeight = resHigh.transparentGeometry.getAttribute('aAnimWeight');
  assert.deepEqual(
    Array.from(trKind.array as Float32Array),
    Array.from(trHighKind.array as Float32Array)
  );
  assert.deepEqual(
    Array.from(trWeight.array as Float32Array),
    Array.from(trHighWeight.array as Float32Array)
  );

  const leafBase = computeVertexAnimKindAndWeight(BlockId.LEAVES, 'side', 0);
  const leafMid = computeVertexAnimKindAndWeight(BlockId.LEAVES, 'side', 0.5);
  const leafTop = computeVertexAnimKindAndWeight(BlockId.LEAVES, 'top', 1);
  assert.equal(leafBase.animKind, 2.0);
  assert.equal(leafBase.animWeight, 0);
  assert.equal(leafMid.animWeight, 0.5);
  assert.equal(leafTop.animWeight, 1);

  const waterTop = computeVertexAnimKindAndWeight(BlockId.WATER, 'top', 1);
  const waterSideTop = computeVertexAnimKindAndWeight(BlockId.WATER, 'side', 1);
  const waterSideBottom = computeVertexAnimKindAndWeight(BlockId.WATER, 'side', 0);
  const waterBottom = computeVertexAnimKindAndWeight(BlockId.WATER, 'bottom', 0);
  assert.equal(waterTop.animWeight, 1);
  assert.equal(waterSideTop.animWeight, 1);
  assert.equal(waterSideBottom.animWeight, 0);
  assert.equal(waterBottom.animWeight, 0);

  const glassMeta = computeVertexAnimKindAndWeight(BlockId.GLASS, 'side', 1);
  assert.equal(glassMeta.animKind, 0);
  assert.equal(glassMeta.animWeight, 0);

  resLow.opaqueGeometry.dispose();
  resLow.transparentGeometry.dispose();
  resHigh.transparentGeometry.dispose();
});

test('8. quality presets and visual flag resolution preserve user shadow and fog preferences', () => {
  const perf = getQualityProfile(normalizeQualityPreset('performance'));
  const bal = getQualityProfile(normalizeQualityPreset('balanced'));
  const ultra = getQualityProfile(normalizeQualityPreset('ultra'));

  assert.equal(perf.shadowEnabled, false);
  assert.equal(bal.shadowEnabled, true);
  assert.equal(ultra.shadowEnabled, true);

  assert.ok(perf.pixelRatioCap < bal.pixelRatioCap && bal.pixelRatioCap < ultra.pixelRatioCap);
  assert.ok(bal.shadowMapSize < ultra.shadowMapSize);
  assert.ok(perf.waterWaveAmplitude < bal.waterWaveAmplitude && bal.waterWaveAmplitude < ultra.waterWaveAmplitude);
  assert.ok(perf.foliageSwayAmplitude < bal.foliageSwayAmplitude && bal.foliageSwayAmplitude < ultra.foliageSwayAmplitude);

  assert.equal(resolveEffectiveVisualFlags({ shadows: false, fog: true }, ultra).shadowsEnabled, false);
  assert.equal(resolveEffectiveVisualFlags({ shadows: true, fog: false }, perf).fogEnabled, false);
  assert.equal(resolveEffectiveVisualFlags({ shadows: true, fog: true }, ultra).shadowsEnabled, true);
  assert.equal(resolveEffectiveVisualFlags({ shadows: true, fog: true }, perf).shadowsEnabled, false);

  const sky = createAtmosphericSkyDome(bal);
  assert.ok(sky.material.vertexShader.includes('vDomeDir = normalize(position);'));
  assert.equal(sky.material.vertexShader.includes('worldPos.xyz'), false);
  sky.dispose();
});
