import {
  createSettingsForMode,
  detectRecommendedQualityMode,
  GameSettings,
  GraphicsQualityMode,
  WorldMetadata
} from '../core/gameState.js';
import {
  BlockId,
  createDefaultInventory,
  DEFAULT_HOTBAR_BLOCKS,
  getBlockDefinition,
  InventorySlot
} from '../core/types.js';

export interface HudSnapshot {
  fps: number;
  position: { x: number; y: number; z: number };
  chunk: { cx: number; cz: number };
  loadedChunks: number;
  targetBlock: { name: string; distance: number } | null;
  selectedSlot: number;
  hotbarBlockIds: number[];
  inventory: InventorySlot[];
  qualityMode: GraphicsQualityMode;
  settings: GameSettings;
  worldName: string;
  seed: string;
  pointerLocked: boolean;
  statusMessage: string | null;
}

export class GameState {
  public settings: GameSettings;
  public inventory: InventorySlot[];
  public hotbarBlockIds: number[];
  public selectedHotbarIndex = 0;
  public pointerLocked = false;
  public statusMessage: string | null = null;
  public worldMeta: WorldMetadata;

  constructor(meta: WorldMetadata, initialSettings?: Partial<GameSettings>) {
    this.worldMeta = { ...meta };
    const detected = initialSettings?.qualityMode ?? detectRecommendedQualityMode();
    this.settings = createSettingsForMode(detected, initialSettings);
    this.inventory = createDefaultInventory();
    this.hotbarBlockIds = [...DEFAULT_HOTBAR_BLOCKS];
  }

  setQualityMode(mode: GraphicsQualityMode): void {
    this.settings = createSettingsForMode(mode, {
      fov: this.settings.fov,
      mouseSensitivity: this.settings.mouseSensitivity,
      sfxVolume: this.settings.sfxVolume,
      muted: this.settings.muted
    });
  }

  getSelectedBlockId(): number {
    const candidate = this.hotbarBlockIds[this.selectedHotbarIndex];
    if (typeof candidate === 'number' && candidate !== BlockId.AIR) {
      return candidate;
    }
    return BlockId.STONE;
  }

  selectHotbarSlot(index: number): void {
    if (index >= 0 && index < this.hotbarBlockIds.length) {
      this.selectedHotbarIndex = index;
    }
  }

  addBlockToInventory(blockId: number, amount = 1): void {
    if (blockId === BlockId.AIR || amount <= 0) {
      return;
    }
    const existing = this.inventory.find((s) => s.blockId === blockId);
    if (existing) {
      existing.count += amount;
    } else {
      this.inventory.push({ blockId, count: amount });
    }
    if (!this.hotbarBlockIds.includes(blockId)) {
      const emptyIdx = this.hotbarBlockIds.findIndex((id) => id === BlockId.AIR);
      if (emptyIdx >= 0) {
        this.hotbarBlockIds[emptyIdx] = blockId;
      }
    }
  }

  consumeBlockFromInventory(blockId: number, amount = 1): boolean {
    if (blockId === BlockId.AIR) return true;
    const existing = this.inventory.find((s) => s.blockId === blockId);
    if (!existing || existing.count < amount) {
      return false;
    }
    existing.count -= amount;
    return true;
  }

  getBlockCount(blockId: number): number {
    return this.inventory.find((s) => s.blockId === blockId)?.count ?? 0;
  }

  getBlockName(blockId: number): string {
    return getBlockDefinition(blockId).name;
  }

  setStatus(msg: string | null): void {
    this.statusMessage = msg;
  }
}
