import { GameSettings, SavedWorldData, WorldMetadata } from './core/gameState.js';
import { HOTBAR_SIZE } from './core/types.js';
import { GameEngine } from './engine/gameEngine.js';
import { WorldGenerator } from './world/worldGenerator.js';
import { ChunkManager } from './world/chunkManager.js';
import { PlayerController } from './player/playerController.js';
import {
  TargetBlockHit,
  mineTargetedBlock,
  placeBlockAtTarget,
  raycastBlocks
} from './building/blockInteraction.js';
import { InventoryManager } from './inventory/inventoryManager.js';
import { WORLD_SAVE_VERSION, WorldStorage } from './persistence/worldStorage.js';
import { SoundEngine } from './audio/soundEngine.js';
import { HudController, ScreenOverlay } from './ui/hudController.js';

class BlockWorldApp {
  private readonly storage = new WorldStorage();
  private readonly sound = new SoundEngine();
  private readonly engine: GameEngine;
  private readonly hud: HudController;

  private settings: GameSettings;
  private activeScreen: ScreenOverlay = 'menu';
  private settingsReturnScreen: 'menu' | 'pause' = 'menu';

  private currentMeta: WorldMetadata | null = null;
  private generator: WorldGenerator | null = null;
  private chunks: ChunkManager | null = null;
  private player: PlayerController | null = null;
  private inventory: InventoryManager;
  private currentTarget: TargetBlockHit | null = null;

  private lastFrameTime = 0;
  private stepAccumulator = 0;

  constructor() {
    this.settings = this.storage.loadSettings();
    this.sound.configure(this.settings.sfxVolume, this.settings.muted);

    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    if (!canvas) {
      throw new Error('Canvas #game-canvas não encontrado.');
    }

    this.engine = new GameEngine(canvas, this.settings);
    this.inventory = new InventoryManager();

    this.hud = new HudController({
      onStartNewWorld: (name, seed) => {
        this.sound.playClick();
        this.startNewWorld(name, seed);
      },
      onLoadWorld: (worldId) => {
        this.sound.playClick();
        this.loadSavedWorld(worldId);
      },
      onDeleteWorld: (worldId) => {
        this.sound.playClick();
        this.storage.deleteWorld(worldId);
        this.hud.renderSavedWorlds(this.storage.listWorlds());
        this.hud.showToast('Mundo removido.');
      },
      onSelectHotbarSlot: (index) => {
        this.sound.playClick();
        this.inventory.setSelectedHotbarIndex(index);
        this.hud.renderHotbar(this.inventory);
      },
      onAssignInventoryBlock: (blockId) => {
        this.sound.playClick();
        this.inventory.assignBlockToSelectedHotbar(blockId);
        this.hud.renderHotbar(this.inventory);
        this.hud.renderInventoryModal(this.inventory);
      },
      onCloseInventory: () => {
        this.sound.playClick();
        this.closeInventoryAndLock();
      },
      onResumeGame: () => {
        this.sound.playClick();
        this.resumeGameAndLock();
      },
      onSaveWorldNow: () => {
        this.sound.playClick();
        this.saveCurrentWorld();
      },
      onOpenSettings: (from) => {
        this.sound.playClick();
        this.settingsReturnScreen = from;
        this.hud.populateSettingsForm(this.settings);
        this.setOverlay('settings');
      },
      onCloseSettings: () => {
        this.sound.playClick();
        this.setOverlay(this.settingsReturnScreen);
      },
      onSaveSettings: (updated) => {
        this.sound.playClick();
        this.settings = updated;
        this.storage.saveSettings(updated);
        this.sound.configure(updated.sfxVolume, updated.muted);
        this.engine.applySettings(updated);
        this.player?.setSensitivity(updated.mouseSensitivity);
        if (this.chunks && this.player) {
          this.chunks.updateAroundPosition(
            this.player.position.x,
            this.player.position.z,
            this.settings.renderDistance,
            12
          );
        }
        this.hud.showToast('Opções aplicadas e salvas.');
        this.setOverlay(this.settingsReturnScreen);
      },
      onExitToMenu: () => {
        this.sound.playClick();
        this.saveCurrentWorld();
        this.exitPointerLock();
        this.teardownWorld();
        this.hud.renderSavedWorlds(this.storage.listWorlds());
        this.setOverlay('menu');
      }
    });

    this.hud.renderSavedWorlds(this.storage.listWorlds());
    this.hud.renderHotbar(this.inventory);
    this.setOverlay('menu');
    this.bindWindowEvents();
    this.startLoop();
  }

  private bindWindowEvents(): void {
    window.addEventListener('resize', () => {
      this.engine.resize(window.innerWidth, window.innerHeight);
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyE' && this.isInWorld()) {
        e.preventDefault();
        if (this.activeScreen === 'inventory') {
          this.closeInventoryAndLock();
        } else if (this.activeScreen === 'none') {
          this.openInventory();
        }
        return;
      }

      if (e.code === 'Escape' && this.isInWorld()) {
        if (this.activeScreen === 'inventory' || this.activeScreen === 'settings') {
          this.setOverlay('pause');
          return;
        }
        if (this.activeScreen === 'none') {
          this.setOverlay('pause');
          return;
        }
      }

      if (this.activeScreen === 'none' && this.player) {
        if (e.code === 'Space' && this.player.grounded) {
          this.sound.playJump();
        }
        this.player.handleKeyDown(e.code);

        if (e.code.startsWith('Digit')) {
          const digit = Number(e.code.replace('Digit', ''));
          if (digit >= 1 && digit <= 9) {
            this.inventory.setSelectedHotbarIndex(digit - 1);
            this.hud.renderHotbar(this.inventory);
          } else if (digit === 0 && HOTBAR_SIZE >= 10) {
            this.inventory.setSelectedHotbarIndex(9);
            this.hud.renderHotbar(this.inventory);
          }
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      this.player?.handleKeyUp(e.code);
    });

    window.addEventListener('mousemove', (e) => {
      if (this.activeScreen === 'none' && this.player) {
        this.player.handleMouseMove(e.movementX, e.movementY);
      }
    });

    window.addEventListener(
      'wheel',
      (e) => {
        if (this.activeScreen === 'none' && this.isInWorld()) {
          const delta = e.deltaY > 0 ? 1 : -1;
          this.inventory.cycleHotbarSelection(delta);
          this.hud.renderHotbar(this.inventory);
        }
      },
      { passive: true }
    );

    this.engine.canvas.addEventListener('mousedown', (e) => {
      if (!this.isInWorld() || this.activeScreen !== 'none') return;

      if (!this.player?.isPointerLocked()) {
        this.requestPointerLock();
        return;
      }

      if (!this.chunks || !this.player) return;

      if (e.button === 0) {
        const res = mineTargetedBlock(this.currentTarget, this.chunks, this.inventory);
        if (res.ok) {
          this.sound.playMine();
          this.chunks.rebuildAllDirtyMeshes();
          this.hud.renderHotbar(this.inventory);
        }
      } else if (e.button === 2) {
        const res = placeBlockAtTarget(
          this.currentTarget,
          this.player.position,
          this.chunks,
          this.inventory
        );
        if (res.ok) {
          this.sound.playPlace();
          this.chunks.rebuildAllDirtyMeshes();
          this.hud.renderHotbar(this.inventory);
        } else if (res.reason) {
          this.hud.showToast(res.reason, 1400);
        }
      }
    });

    this.engine.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.engine.canvas;
      this.player?.setPointerLocked(locked);
      if (!locked && this.isInWorld() && this.activeScreen === 'none') {
        this.setOverlay('pause');
      }
    });
  }

  private isInWorld(): boolean {
    return this.currentMeta !== null && this.chunks !== null && this.player !== null;
  }

  private setOverlay(screen: ScreenOverlay): void {
    this.activeScreen = screen;
    if (screen !== 'none') {
      this.player?.resetInputs();
      this.exitPointerLock();
    }
    this.hud.setScreen(screen, this.isInWorld());
  }

  private requestPointerLock(): void {
    try {
      this.engine.canvas.requestPointerLock?.();
    } catch {
      // Ambientes sem suporte a pointer lock ainda permitem interação direta
    }
  }

  private exitPointerLock(): void {
    try {
      if (document.pointerLockElement) {
        document.exitPointerLock?.();
      }
    } catch {
      // Ignora erro caso já desbloqueado
    }
  }

  private openInventory(): void {
    this.hud.renderInventoryModal(this.inventory);
    this.setOverlay('inventory');
  }

  private closeInventoryAndLock(): void {
    this.setOverlay('none');
    this.requestPointerLock();
  }

  private resumeGameAndLock(): void {
    this.setOverlay('none');
    this.requestPointerLock();
  }

  private teardownWorld(): void {
    this.chunks?.disposeAll();
    this.chunks = null;
    this.generator = null;
    this.player = null;
    this.currentMeta = null;
    this.currentTarget = null;
    this.engine.updateTargetHighlight(null);
  }

  private startNewWorld(name: string, seed: string): void {
    this.teardownWorld();

    const gen = new WorldGenerator(seed);
    const spawn = gen.findSafeSpawn(0, 0);
    const now = new Date().toISOString();

    const meta: WorldMetadata = {
      id: `world_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name,
      seed: gen.seedString,
      createdAt: now,
      updatedAt: now,
      playerPosition: spawn,
      yaw: 0,
      pitch: 0
    };

    const chunkMgr = new ChunkManager(
      gen,
      this.engine.scene,
      this.engine.opaqueMaterial,
      this.engine.transparentMaterial
    );

    const playerCtrl = new PlayerController(spawn, 0, 0);
    playerCtrl.setSensitivity(this.settings.mouseSensitivity);

    this.inventory = new InventoryManager();
    this.generator = gen;
    this.chunks = chunkMgr;
    this.player = playerCtrl;
    this.currentMeta = meta;

    chunkMgr.updateAroundPosition(spawn.x, spawn.z, this.settings.renderDistance, 25);
    this.hud.renderHotbar(this.inventory);
    this.setOverlay('none');
    this.requestPointerLock();
    this.hud.showToast(`Mundo "${meta.name}" criado!`);
  }

  private loadSavedWorld(worldId: string): void {
    const saved = this.storage.loadWorld(worldId);
    if (!saved) {
      this.hud.showToast('Não foi possível carregar o mundo selecionado.');
      return;
    }

    this.teardownWorld();

    const gen = new WorldGenerator(saved.meta.seed);
    const chunkMgr = new ChunkManager(
      gen,
      this.engine.scene,
      this.engine.opaqueMaterial,
      this.engine.transparentMaterial
    );
    chunkMgr.loadSavedChunks(saved.modifiedChunks);

    const playerCtrl = new PlayerController(
      saved.meta.playerPosition,
      saved.meta.yaw,
      saved.meta.pitch
    );
    playerCtrl.setSensitivity(this.settings.mouseSensitivity);

    this.inventory = new InventoryManager(
      saved.inventory,
      saved.hotbarBlockIds,
      saved.selectedHotbarIndex
    );
    this.generator = gen;
    this.chunks = chunkMgr;
    this.player = playerCtrl;
    this.currentMeta = { ...saved.meta };

    chunkMgr.updateAroundPosition(
      saved.meta.playerPosition.x,
      saved.meta.playerPosition.z,
      this.settings.renderDistance,
      25
    );
    this.hud.renderHotbar(this.inventory);
    this.setOverlay('none');
    this.requestPointerLock();
    this.hud.showToast(`Mundo "${saved.meta.name}" carregado.`);
  }

  private saveCurrentWorld(): void {
    if (!this.currentMeta || !this.chunks || !this.player) return;

    this.currentMeta.updatedAt = new Date().toISOString();
    this.currentMeta.playerPosition = { ...this.player.position };
    this.currentMeta.yaw = this.player.yaw;
    this.currentMeta.pitch = this.player.pitch;

    const invSerialized = this.inventory.serialize();
    const payload: SavedWorldData = {
      version: WORLD_SAVE_VERSION,
      meta: { ...this.currentMeta },
      inventory: invSerialized.inventory,
      hotbarBlockIds: invSerialized.hotbarBlockIds,
      selectedHotbarIndex: invSerialized.selectedHotbarIndex,
      modifiedChunks: this.chunks.getModifiedChunksSerialized()
    };

    const res = this.storage.saveWorld(payload);
    if (res.ok) {
      this.hud.showToast('Mundo salvo localmente!');
    } else {
      this.hud.showToast(`Erro ao salvar: ${res.errors.join('; ')}`, 3500);
    }
  }

  private startLoop(): void {
    this.lastFrameTime = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - this.lastFrameTime) / 1000, 0.05);
      this.lastFrameTime = now;

      if (this.isInWorld() && this.player && this.chunks && this.generator && this.currentMeta) {
        const prevPos = { ...this.player.position };

        if (this.activeScreen === 'none') {
          this.player.update(dt, this.chunks, this.engine.camera);
        } else {
          this.player.update(0, this.chunks, this.engine.camera);
        }

        const movedDist = Math.hypot(
          this.player.position.x - prevPos.x,
          this.player.position.z - prevPos.z
        );
        if (this.player.grounded && movedDist > 0.01 && this.activeScreen === 'none') {
          this.stepAccumulator += movedDist;
          if (this.stepAccumulator >= 2.2) {
            this.stepAccumulator = 0;
            this.sound.playStep();
          }
        }

        this.chunks.updateAroundPosition(
          this.player.position.x,
          this.player.position.z,
          this.settings.renderDistance,
          3
        );
        this.engine.syncSunWithPlayer(this.player.position.x, this.player.position.z);

        const target = raycastBlocks(
          this.player.getEyePosition(),
          this.player.getLookDirection(),
          this.chunks
        );
        this.currentTarget = target;
        this.engine.updateTargetHighlight(target);

        const biome = this.generator.getBiomeAt(
          Math.floor(this.player.position.x),
          Math.floor(this.player.position.z)
        );
        this.hud.updateHudTelemetry(
          this.currentMeta.name,
          this.player.position.x,
          this.player.position.y,
          this.player.position.z,
          biome,
          target
        );
      }

      this.engine.render();
      window.requestAnimationFrame(tick);
    };

    window.requestAnimationFrame(tick);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new BlockWorldApp();
});
