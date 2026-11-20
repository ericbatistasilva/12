import test from 'node:test';
import assert from 'node:assert/strict';
import { BlockId, CHUNK_HEIGHT, CHUNK_SIZE, getBlockDefinition, isBlockSolid } from '../src/core/types.js';
import { getBlockFaceUvRect } from '../src/world/blockTextureAtlas.js';
import { buildChunkGeometries } from '../src/world/chunkMeshBuilder.js';

test('block definitions preserve solid and non-solid identities', () => {
  assert.equal(getBlockDefinition(BlockId.AIR).solid, false);
  assert.equal(getBlockDefinition(BlockId.WATER).solid, false);
  assert.equal(getBlockDefinition(BlockId.GRASS).solid, true);
  assert.equal(getBlockDefinition(BlockId.STONE).solid, true);
  assert.equal(isBlockSolid(BlockId.STONE), true);
  assert.equal(isBlockSolid(BlockId.WATER), false);
});

test('atlas UV rectangles are valid across top, side, and bottom faces', () => {
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

test('buildChunkGeometries produces UV attributes matching vertex counts with Voxel AO', () => {
  const blocks = new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE);
  const idx = 2 + CHUNK_SIZE * (2 + CHUNK_SIZE * 4);
  blocks[idx] = BlockId.GRASS;

  const { opaqueGeometry, transparentGeometry } = buildChunkGeometries(0, 0, blocks, (wx, wy, wz) => {
    if (wx === 2 && wy === 4 && wz === 2) return BlockId.GRASS;
    return BlockId.AIR;
  });

  assert.equal(transparentGeometry, null);
  assert.ok(opaqueGeometry !== null);

  const posAttr = opaqueGeometry.getAttribute('position');
  const uvAttr = opaqueGeometry.getAttribute('uv');
  const colorAttr = opaqueGeometry.getAttribute('color');

  assert.ok(posAttr && posAttr.count > 0);
  assert.ok(uvAttr && uvAttr.count === posAttr.count);
  assert.ok(colorAttr && colorAttr.count === posAttr.count);

  opaqueGeometry.dispose();
});
