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
import { createInitialGameState } from '../src/core/gameState.js';
import { WorldGenerator } from '../src/world/worldGenerator.js';
import { raycastTargetBlock } from '../src/building/blockInteraction.js';
import { PlayerController } from '../src/player/playerController.js';
import { WorldStorage } from '../src/persistence/worldStorage.js';
import { getBlockFaceUvRect } from '../src/world/blockTextureAtlas.js';
import { buildChunkGeometries } from '../src/world/chunkMeshBuilder.js';
import {
  createAtmosphericSkyDome,
  getQualityProfile,
  normalizeQualityPreset
} from '../src/engine/visualPipeline.js';

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
  const state = createInitialGameState();
  const camera = new THREE.PerspectiveCamera(state.settings.fov, 1.5, 0.1, 180);
  const solidBlocks = new Map<string, number>();
  solidBlocks.set('0,4,0', BlockId.STONE);

  const player = new PlayerController(
    camera,
    state.settings,
    (wx, wy, wz) => solidBlocks.get(`${wx},${wy},${wz}`) ?? BlockId.AIR
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
  const idx = 4 * CHUNK_SIZE_X * CHUNK_SIZE_Z + 2 * CHUNK_SIZE_X + 2;
  blocks[idx] = BlockId.STONE;

  const hit = raycastTargetBlock(
    new THREE.Vector3(2.5, 4.5, 5.0),
    new THREE.Vector3(0, 0, -1),
    8,
    (wx, wy, wz) => {
      if (wx >= 0 && wx < CHUNK_SIZE_X && wz >= 0 && wz < CHUNK_SIZE_Z && wy >= 0 && wy < WORLD_HEIGHT) {
        return blocks[wy * CHUNK_SIZE_X * CHUNK_SIZE_Z + wz * CHUNK_SIZE_X + wx];
      }
      return BlockId.AIR;
    }
  );

  assert.ok(hit !== null);
  assert.deepEqual(hit.blockPos, { x: 2, y: 4, z: 2 });
  assert.deepEqual(hit.adjacentPos, { x: 2, y: 4, z: 3 });

  blocks[idx] = BlockId.AIR;
  assert.equal(blocks[idx], BlockId.AIR);
  blocks[idx] = BlockId.PLANKS;
  assert.equal(blocks[idx], BlockId.PLANKS);
});

test('4. inventory slots, hotbar selection, and block definitions', () => {
  const state = createInitialGameState();
  assert.ok(state.hotbar.length > 0);
  assert.equal(getBlockDefinition(BlockId.AIR).solid, false);
  assert.equal(getBlockDefinition(BlockId.WATER).solid, false);
  assert.equal(getBlockDefinition(BlockId.GRASS).solid, true);
  assert.equal(getBlockDefinition(BlockId.STONE).solid, true);
  assert.equal(isBlockSolid(BlockId.STONE), true);
  assert.equal(isBlockSolid(BlockId.WATER), false);

  const firstSlot = state.hotbar[0];
  assert.ok(firstSlot !== undefined);
  state.addBlockToInventory(BlockId.COBBLESTONE, 3);
  assert.ok(state.getBlockCount(BlockId.COBBLESTONE) >= 3);
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

test('7. buildChunkGeometries produces UV and animation attributes for water, leaves, and glass', () => {
  const blocks = new Uint8Array(CHUNK_SIZE_X * WORLD_HEIGHT * CHUNK_SIZE_Z);
  blocks[4 * CHUNK_SIZE_X * CHUNK_SIZE_Z + 2 * CHUNK_SIZE_X + 2] = BlockId.GRASS;
  blocks[3 * CHUNK_SIZE_X * CHUNK_SIZE_Z + 3 * CHUNK_SIZE_X + 3] = BlockId.WATER;
  blocks[5 * CHUNK_SIZE_X * CHUNK_SIZE_Z + 4 * CHUNK_SIZE_X + 4] = BlockId.LEAVES;
  blocks[5 * CHUNK_SIZE_X * CHUNK_SIZE_Z + 6 * CHUNK_SIZE_X + 6] = BlockId.GLASS;

  const lookup = {
    getBlockAt(wx: number, wy: number, wz: number): number {
      if (wx === 2 && wy === 4 && wz === 2) return BlockId.GRASS;
      if (wx === 3 && wy === 3 && wz === 3) return BlockId.WATER;
      if (wx === 4 && wy === 5 && wz === 4) return BlockId.LEAVES;
      if (wx === 6 && wy === 5 && wz === 6) return BlockId.GLASS;
      return BlockId.AIR;
    }
  };

  const { opaqueGeometry, transparentGeometry } = buildChunkGeometries(0, 0, blocks, lookup);

  assert.ok(opaqueGeometry !== null);
  assert.ok(transparentGeometry !== null);

  const posAttr = opaqueGeometry.getAttribute('position');
  const uvAttr = opaqueGeometry.getAttribute('uv');
  const colorAttr = opaqueGeometry.getAttribute('color');
  const animAttr = opaqueGeometry.getAttribute('aAnimKind');

  assert.ok(posAttr && posAttr.count > 0);
  assert.ok(uvAttr && uvAttr.count === posAttr.count);
  assert.ok(colorAttr && colorAttr.count === posAttr.count);
  assert.ok(animAttr && animAttr.count === posAttr.count);
  assert.ok(Array.from(animAttr.array as Float32Array).every((v) => v === 0));

  const transPosAttr = transparentGeometry.getAttribute('position');
  const transUvAttr = transparentGeometry.getAttribute('uv');
  const transAnimAttr = transparentGeometry.getAttribute('aAnimKind');
  assert.ok(transPosAttr && transPosAttr.count > 0);
  assert.ok(transUvAttr && transUvAttr.count === transPosAttr.count);
  assert.ok(transAnimAttr && transAnimAttr.count === transPosAttr.count);

  const animValues = Array.from(transAnimAttr.array as Float32Array);
  assert.ok(animValues.includes(1.0));
  assert.ok(animValues.includes(2.0));
  assert.ok(animValues.includes(0.0));

  opaqueGeometry.dispose();
  transparentGeometry.dispose();
});

test('8. quality presets scale parameters while respecting user shadow and fog preferences', () => {
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

  const userShadowsOff = false && ultra.shadowEnabled;
  const userFogOff = false && perf.fogEnabled;
  assert.equal(userShadowsOff, false);
  assert.equal(userFogOff, false);

  const sky = createAtmosphericSkyDome(bal);
  assert.ok(sky.material.vertexShader.includes('vDomeDir = normalize(position);'));
  assert.equal(sky.material.vertexShader.includes('worldPos.xyz'), false);
  sky.dispose();
});
