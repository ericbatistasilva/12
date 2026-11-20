import * as THREE from 'three';
import { GameEngine } from '../engine/gameEngine.js';
import { ChunkManager } from '../world/chunkManager.js';
import { WorldGenerator } from '../world/worldGenerator.js';
import { PlayerController } from '../player/playerController.js';
import { InputManager } from '../core/inputManager.js';
import { BlockRaycast, TargetBlockHit } from '../building/blockInteraction.js';
import { GameState } from '../core/gameState.js';
import { HudController } from '../ui/hudController.js';
import { SoundEngine } from '../audio/soundEngine.js';
import { chunkKey, worldToChunkCoord } from '../world/chunk.js';
import { SavedWorldData } from '../core/gameState.js';

export interface SessionHooks {
  onSaveWorld: (data: SavedWorldData) => void;
  onExitToMenu: () => void;
}

export class GameSession {
  private readonly canvas: HTMLCanvasElement;
  private readonly hudRoot: HTMLElement;
  private readonly hooks: SessionHooks;
  public readonly state: GameState;
  public readonly generator: WorldGenerator;
  public readonly engine: GameEngine;
  public readonly chunkManager: ChunkManager;
  public readonly input: InputManager;
  public readonly player: PlayerController;
  public readonly raycast: BlockRaycast;
  public readonly hud: HudController;
  public readonly sound: SoundEngine;

  private readonly modifiedKeys = new Set<string>();
  private rafId: number | null = null;
  private lastFrameMs = 0;
  private elapsedSec = 0;
  private fpsAccumTime = 0;
  private fpsFrames = 0;
  private currentFps = 60;
  private currentTarget: TargetBlockHit | null = null;
  private disposed = false;

  constructor(
    canvas: HTMLCanvasElement,
    hudRoot: HTMLElement,
    savedData: SavedWorldData,
    hooks: SessionHooks
  ) {
    this.canvas = canvas;
    this.hudRoot = hudRoot;
    this.hooks = hooks;

    this.state = new GameState(savedData.meta, {
      fov: 75,
      mouseSensitivity: 1.0,
      sfxVolume: 0.6,
      muted: false
    });
    this.state.inventory = savedData.inventory.map((i) => ({ ...i }));
    this.state.hotbarBlockIds = [...savedData.hotbarBlockIds];
    this.state.selectedHotbarIndex = savedData.selectedHotbarIndex;

    this.generator = new WorldGenerator(savedData.meta.seed);
    this.engine = new GameEngine(
      this.canvas,
      this.state.settings,
      this.generator.seedNumber
    );

    this.chunkManager = new ChunkManager(
      this.engine.scene,
      this.generator,
      {
        opaqueMaterial: this.engine.opaqueMaterial,
        foliageMaterial: this.engine.foliageMaterial,
        glassMaterial: this.engine.glassMaterial,
        waterMaterial: this.engine.waterMaterial
      },
      {
        aoStrength: this.engine.getActivePreset().aoStrength,
        shadowsEnabled: this.state.settings.shadows && this.engine.getActivePreset().shadows
      }
    );

    this.sound = new SoundEngine(this.state.settings);
    this.input = new InputManager(this.canvas);
    this.player = new PlayerController(
      this.engine.camera,
      this.input,
      (wx, wy, wz) => this.chunkManager.getBlockWorld(wx, wy, wz),
      this.state.settings
    );
    this.player.setPosition(
      savedData.meta.playerPosition.x,
      savedData.meta.playerPosition.y,
      savedData.meta.playerPosition.z
    );
    this.player.setOrientation(savedData.meta.yaw, savedData.meta.pitch);

    this.raycast = new BlockRaycast((wx, wy, wz) => this.chunkManager.getBlockWorld(wx, wy, wz));

    this.hud = new HudController(this.hudRoot, {
      onSelectHotbar: (idx) => this.state.selectHotbarSlot(idx),
      onAssignHotbarBlock: (slotIdx, blockId) => {
        this.state.hotbarBlockIds[slotIdx] = blockId;
        this.state.selectHotbarSlot(slotIdx);
      },
      onUpdateSettings: (partial) => {
        this.state.settings = { ...this.state.settings, ...partial };
        this.engine.applySettings(this.state.settings);
        this.chunkManager.setVisualOptions({
          aoStrength: this.engine.getActivePreset().aoStrength,
          shadowsEnabled: this.state.settings.shadows && this.engine.getActivePreset().shadows
        });
        this.player.applySettings(this.state.settings);
        this.sound.applySettings(this.state.settings);
      },
      onSaveWorld: () => this.triggerSave(),
      onReturnToMenu: () => this.hooks.onExitToMenu(),
      onRequestPointerLock: () => this.canvas.requestPointerLock?.()
    });

    for (const mc of savedData.modifiedChunks) {
      this.chunkManager.applySavedChunk(mc.cx, mc.cz, mc.blocks);
      this.modifiedKeys.add(chunkKey(mc.cx, mc.cz));
    }

    this.chunkManager.updateAroundPlayer(
      this.player.position.x,
      this.player.position.z,
      this.state.settings.renderDistance,
      24
    );
    this.engine.syncSunAndAtmosphere(
      this.player.position.x,
      this.player.position.z,
      0,
      this.state.settings.fog
    );

    this.bindSessionEvents();
    this.engine.render();
  }

  private bindSessionEvents(): void {
    this.input.on('pointerlockchange', (locked: unknown) => {
      this.state.pointerLocked = Boolean(locked);
    });

    this.input.on('hotbar', (slotIndex: unknown) => {
      if (typeof slotIndex === 'number') {
        this.state.selectHotbarSlot(slotIndex);
      }
    });

    this.input.on('toggleDebug', () => {
      this.hud.toggleDebug();
    });

    this.input.on('toggleInventory', () => {
      this.hud.toggleInventory();
    });

    this.input.on('pauseMenu', () => {
      if (this.hud.hasOpenModal()) {
        this.hud.closeModals();
      } else {
        this.hud.toggleSettings();
      }
    });

    this.input.on('mine', () => {
      if (!this.state.pointerLocked || this.hud.hasOpenModal()) return;
      if (!this.currentTarget) return;
      const { x, y, z } = this.currentTarget.blockPos;
      const removedId = this.chunkManager.getBlockWorld(x, y, z);
      if (removedId === 0 || removedId === 7) return;
      if (this.chunkManager.setBlockWorld(x, y, z, 0)) {
        const { cx, cz } = worldToChunkCoord(x, z);
        this.modifiedKeys.add(chunkKey(cx, cz));
        this.state.addBlockToInventory(removedId, 1);
        this.sound.playMine(removedId);
      }
    });

    this.input.on('place', () => {
      if (!this.state.pointerLocked || this.hud.hasOpenModal()) return;
      if (!this.currentTarget || !this.currentTarget.adjacentPos) return;
      const { x, y, z } = this.currentTarget.adjacentPos;
      const placeId = this.state.getSelectedBlockId();
      if (!placeId) return;
      if (this.player.intersectsBlock(x, y, z)) return;
      const currentAtTarget = this.chunkManager.getBlockWorld(x, y, z);
      if (currentAtTarget !== 0 && currentAtTarget !== 7) return;
      if (!this.state.consumeBlockFromInventory(placeId, 1)) {
        this.state.setStatus(`Sem blocos de ${this.state.getBlockName(placeId)} no inventário`);
        setTimeout(() => this.state.setStatus(null), 1500);
        return;
      }
      if (this.chunkManager.setBlockWorld(x, y, z, placeId)) {
        const { cx, cz } = worldToChunkCoord(x, z);
        this.modifiedKeys.add(chunkKey(cx, cz));
        this.sound.playPlace(placeId);
      } else {
        this.state.addBlockToInventory(placeId, 1);
      }
    });

    window.addEventListener('resize', this.handleResize);
  }

  private handleResize = (): void => {
    this.engine.resize(window.innerWidth, window.innerHeight);
  };

  startLoop(): void {
    if (this.rafId !== null || this.disposed) return;
    this.lastFrameMs = performance.now();
    const tick = (nowMs: number) => {
      if (this.disposed) return;
      const rawDt = (nowMs - this.lastFrameMs) / 1000;
      this.lastFrameMs = nowMs;
      const dt = Math.min(0.05, Math.max(0.001, rawDt));
      this.elapsedSec += dt;

      this.fpsAccumTime += dt;
      this.fpsFrames++;
      if (this.fpsAccumTime >= 0.5) {
        this.currentFps = Math.round(this.fpsFrames / this.fpsAccumTime);
        this.fpsAccumTime = 0;
        this.fpsFrames = 0;
      }

      const modalOpen = this.hud.hasOpenModal();
      this.player.update(dt, !modalOpen);

      // Ondulação sutil da água e brisa suave na vegetação
      const preset = this.engine.getActivePreset();
      if (preset.waterAnimated) {
        const waveY = Math.sin(this.elapsedSec * 2.1) * 0.018;
        this.engine.waterMaterial.displacementScale = 0;
        this.engine.textures.map.offset.x = Math.sin(this.elapsedSec * 0.14) * 0.015;
        this.engine.waterMaterial.opacity = 0.74 + waveY * 1.4;
      }

      this.chunkManager.updateAroundPlayer(
        this.player.position.x,
        this.player.position.z,
        this.state.settings.renderDistance,
        this.state.settings.qualityMode === 'ultra' ? 4 : 3
      );

      this.engine.syncSunAndAtmosphere(
        this.player.position.x,
        this.player.position.z,
        this.elapsedSec,
        this.state.settings.fog
      );

      const camPos = new THREE.Vector3();
      const camDir = new THREE.Vector3();
      this.engine.camera.getWorldPosition(camPos);
      this.engine.camera.getWorldDirection(camDir);
      this.currentTarget = this.raycast.cast(camPos, camDir, 6);
      this.engine.updateTargetHighlight(this.currentTarget);

      this.engine.render();

      const chunkCoord = worldToChunkCoord(
        Math.floor(this.player.position.x),
        Math.floor(this.player.position.z)
      );
      this.hud.update({
        fps: this.currentFps,
        position: {
          x: this.player.position.x,
          y: this.player.position.y,
          z: this.player.position.z
        },
        chunk: chunkCoord,
        loadedChunks: this.chunkManager.getLoadedChunkCount(),
        targetBlock: this.currentTarget
          ? {
              name: getBlockDefinition(this.currentTarget.blockId).name,
              distance: this.currentTarget.distance
            }
          : null,
        selectedSlot: this.state.selectedHotbarIndex,
        hotbarBlockIds: this.state.hotbarBlockIds,
        inventory: this.state.inventory,
        qualityMode: this.state.settings.qualityMode,
        settings: this.state.settings,
        worldName: this.state.worldMeta.name,
        seed: this.state.worldMeta.seed,
        pointerLocked: this.state.pointerLocked,
        statusMessage: this.state.statusMessage
      });

      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  triggerSave(): SavedWorldData {
    const modifiedChunks = this.chunkManager.exportModifiedChunks((cx, cz) =>
      this.modifiedKeys.has(chunkKey(cx, cz))
    );
    const data: SavedWorldData = {
      version: 1,
      meta: {
        ...this.state.worldMeta,
        updatedAt: new Date().toISOString(),
        playerPosition: {
          x: this.player.position.x,
          y: this.player.position.y,
          z: this.player.position.z
        },
        yaw: this.player.yaw,
        pitch: this.player.pitch
      },
      inventory: this.state.inventory.map((i) => ({ ...i })),
      hotbarBlockIds: [...this.state.hotbarBlockIds],
      selectedHotbarIndex: this.state.selectedHotbarIndex,
      modifiedChunks
    };
    this.hooks.onSaveWorld(data);
    this.state.setStatus('Mundo salvo com sucesso');
    setTimeout(() => this.state.setStatus(null), 1800);
    return data;
  }

  dispose(): void {
    this.disposed = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    window.removeEventListener('resize', this.handleResize);
    this.input.dispose();
    this.hud.dispose();
    this.chunkManager.dispose();
    this.engine.dispose();
    this.sound.dispose();
  }
}
