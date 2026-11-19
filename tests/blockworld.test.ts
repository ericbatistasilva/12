import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BlockId, CHUNK_SIZE_X, CHUNK_SIZE_Z, WORLD_HEIGHT } from '../src/core/types.js';
import { WorldGenerator } from '../src/world/worldGenerator.js';
import { ChunkManager } from '../src/world/chunkManager.js';
import { stepPlayerPhysics, createPlayerAABB, collidesWithWorld } from '../src/physics/collision.js';
import { InventoryManager } from '../src/inventory/inventoryManager.js';
import { mineTargetedBlock, placeBlockAtTarget, TargetBlockHit } from '../src/building/blockInteraction.js';
import { WORLD_SAVE_VERSION, WorldStorage, validateSavedWorldIntegrity } from '../src/persistence/worldStorage.js';
import { SavedWorldData } from '../src/core/gameState.js';

describe('BlockWorld — Testes Essenciais', () => {
  it('1. Geração de terreno é determinística por semente e produz múltiplos tipos de blocos', () => {
    const genA = new WorldGenerator('semente-alpha-123');
    const genB = new WorldGenerator('semente-alpha-123');
    const genOther = new WorldGenerator('semente-beta-999');

    const chunkA = genA.generateChunkBlocks(0, 0);
    const chunkB = genB.generateChunkBlocks(0, 0);
    const chunkOther = genOther.generateChunkBlocks(0, 0);

    assert.equal(chunkA.length, CHUNK_SIZE_X * WORLD_HEIGHT * CHUNK_SIZE_Z);
    assert.deepEqual(Array.from(chunkA), Array.from(chunkB));
    assert.notDeepEqual(Array.from(chunkA), Array.from(chunkOther));

    const presentBlocks = new Set<number>(chunkA);
    assert.ok(presentBlocks.has(BlockId.STONE), 'Deve gerar pedra');
    assert.ok(presentBlocks.has(BlockId.DIRT) || presentBlocks.has(BlockId.SAND), 'Deve gerar terra ou areia');
    assert.ok(presentBlocks.has(BlockId.GRASS) || presentBlocks.has(BlockId.WATER), 'Deve gerar grama ou água');
  });

  it('2. Física e colisões impedem atravessar bloco sólido e permitem salto', () => {
    const solidWallWorld = {
      isSolidAt(wx: number, wy: number, wz: number): boolean {
        if (wy === 0) return true; // Chão sólido
        if (wx === 2 && wz === 0 && wy >= 1 && wy <= 2) return true; // Parede sólida à frente
        return false;
      }
    };

    const startPos = { x: 0.5, y: 1, z: 0.5 };
    const startBox = createPlayerAABB(startPos);
    assert.equal(collidesWithWorld(startBox, solidWallWorld), false);

    // Move para frente (+X, yaw = -Math.PI/2 aponta para +X) em direção à parede em x=2
    let pos = { ...startPos };
    let vel = { x: 0, y: 0, z: 0 };
    const moveRightInput = {
      forward: false,
      backward: false,
      left: false,
      right: true,
      jump: false,
      sprint: false
    };

    for (let i = 0; i < 40; i++) {
      const step = stepPlayerPhysics(pos, vel, 0, moveRightInput, 0.02, solidWallWorld);
      pos = step.position;
      vel = step.velocity;
    }

    // Limite do AABB do jogador (pos.x + 0.32) não deve ultrapassar x=2.0
    assert.ok(pos.x + 0.32 <= 2.0001, `Jogador atravessou parede: pos.x=${pos.x}`);

    // Testa salto quando apoiado no chão
    const groundedStep = stepPlayerPhysics(
      { x: 0.5, y: 1, z: 0.5 },
      { x: 0, y: 0, z: 0 },
      0,
      { forward: false, backward: false, left: false, right: false, jump: true, sprint: false },
      0.016,
      solidWallWorld
    );
    assert.ok(groundedStep.velocity.y > 0, 'Velocidade vertical deve subir ao pular');
  });

  it('3. Quebra e colocação de blocos alteram o mundo e atualizam o inventário', () => {
    const gen = new WorldGenerator('construcao-seed');
    const chunks = new ChunkManager(gen);
    const inv = new InventoryManager([{ blockId: BlockId.PLANKS, count: 3 }], [BlockId.PLANKS], 0);

    chunks.setBlockAt(4, 10, 4, BlockId.STONE);
    assert.equal(chunks.getBlockAt(4, 10, 4), BlockId.STONE);

    const mineTarget: TargetBlockHit = {
      blockPos: { x: 4, y: 10, z: 4 },
      normal: { x: 0, y: 1, z: 0 },
      adjacentPos: { x: 4, y: 11, z: 4 },
      blockId: BlockId.STONE,
      distance: 2.5
    };

    const mineRes = mineTargetedBlock(mineTarget, chunks, inv);
    assert.equal(mineRes.ok, true);
    assert.equal(chunks.getBlockAt(4, 10, 4), BlockId.AIR);
    assert.equal(inv.getCount(BlockId.COBBLESTONE), 1);

    const placeTarget: TargetBlockHit = {
      blockPos: { x: 4, y: 9, z: 4 },
      normal: { x: 0, y: 1, z: 0 },
      adjacentPos: { x: 4, y: 10, z: 4 },
      blockId: BlockId.STONE,
      distance: 2.5
    };

    const placeRes = placeBlockAtTarget(placeTarget, { x: 0, y: 10, z: 0 }, chunks, inv);
    assert.equal(placeRes.ok, true);
    assert.equal(chunks.getBlockAt(4, 10, 4), BlockId.PLANKS);
    assert.equal(inv.getCount(BlockId.PLANKS), 2);
  });

  it('4. Inventário adiciona, consome e seleciona itens com segurança', () => {
    const inv = new InventoryManager([], [BlockId.DIRT, BlockId.WOOD], 0);
    assert.equal(inv.getSelectedBlockId(), BlockId.DIRT);

    assert.equal(inv.consumeItem(BlockId.DIRT, 1), false);
    assert.equal(inv.addItem(BlockId.DIRT, 5), true);
    assert.equal(inv.getCount(BlockId.DIRT), 5);

    assert.equal(inv.consumeItem(BlockId.DIRT, 2), true);
    assert.equal(inv.getCount(BlockId.DIRT), 3);

    inv.cycleHotbarSelection(1);
    assert.equal(inv.getSelectedBlockId(), BlockId.WOOD);
  });

  it('5. Salvamento, carregamento e validação de integridade do mundo funcionam', () => {
    const storage = new WorldStorage();
    const gen = new WorldGenerator('persist-seed');
    const chunks = new ChunkManager(gen);
    chunks.setBlockAt(1, 12, 1, BlockId.GLASS);

    const savedData: SavedWorldData = {
      version: WORLD_SAVE_VERSION,
      meta: {
        id: 'test-world-1',
        name: 'Mundo Teste',
        seed: 'persist-seed',
        createdAt: '2026-11-19T20:00:00.000Z',
        updatedAt: '2026-11-19T20:05:00.000Z',
        playerPosition: { x: 1.5, y: 13, z: 2.5 },
        yaw: 0.4,
        pitch: -0.1
      },
      inventory: [{ blockId: BlockId.GLASS, count: 7 }],
      hotbarBlockIds: [BlockId.GLASS],
      selectedHotbarIndex: 0,
      modifiedChunks: chunks.getModifiedChunksSerialized()
    };

    assert.equal(validateSavedWorldIntegrity(savedData).valid, true);
    const saveResult = storage.saveWorld(savedData);
    assert.equal(saveResult.ok, true);

    const loaded = storage.loadWorld('test-world-1');
    assert.ok(loaded !== null);
    assert.equal(loaded?.meta.name, 'Mundo Teste');
    assert.equal(loaded?.meta.playerPosition.x, 1.5);

    const restoredChunks = new ChunkManager(new WorldGenerator('persist-seed'));
    restoredChunks.loadSavedChunks(loaded!.modifiedChunks);
    assert.equal(restoredChunks.getBlockAt(1, 12, 1), BlockId.GLASS);

    // Integridade deve rejeitar chunk com tamanho corrompido
    const corrupted: SavedWorldData = {
      ...savedData,
      modifiedChunks: [{ cx: 0, cz: 0, blocks: [1, 2, 3] }]
    };
    assert.equal(validateSavedWorldIntegrity(corrupted).valid, false);
  });
});
