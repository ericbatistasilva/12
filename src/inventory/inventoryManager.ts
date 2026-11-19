import {
  BlockId,
  HOTBAR_SIZE,
  PLACEABLE_BLOCKS,
  getBlockDefinition
} from '../core/types.js';
import { InventorySlot } from '../core/gameState.js';

export class InventoryManager {
  public slots: InventorySlot[] = [];
  public hotbarBlockIds: number[] = [];
  public selectedHotbarIndex = 0;

  constructor(
    initialSlots?: InventorySlot[],
    initialHotbar?: number[],
    selectedIndex = 0
  ) {
    if (initialSlots && initialSlots.length > 0) {
      this.slots = initialSlots.map((s) => ({ blockId: s.blockId, count: Math.max(0, s.count) }));
    } else {
      this.resetDefaultInventory();
    }

    if (initialHotbar && initialHotbar.length === HOTBAR_SIZE) {
      this.hotbarBlockIds = [...initialHotbar];
    } else {
      this.hotbarBlockIds = PLACEABLE_BLOCKS.slice(0, HOTBAR_SIZE);
      while (this.hotbarBlockIds.length < HOTBAR_SIZE) {
        this.hotbarBlockIds.push(BlockId.DIRT);
      }
    }

    this.setSelectedHotbarIndex(selectedIndex);
  }

  resetDefaultInventory(): void {
    this.slots = [
      { blockId: BlockId.GRASS, count: 24 },
      { blockId: BlockId.DIRT, count: 32 },
      { blockId: BlockId.STONE, count: 24 },
      { blockId: BlockId.COBBLESTONE, count: 20 },
      { blockId: BlockId.SAND, count: 20 },
      { blockId: BlockId.WOOD, count: 16 },
      { blockId: BlockId.PLANKS, count: 32 },
      { blockId: BlockId.GLASS, count: 16 },
      { blockId: BlockId.FLOWER, count: 10 },
      { blockId: BlockId.LEAVES, count: 12 },
      { blockId: BlockId.WATER, count: 8 },
      { blockId: BlockId.TALL_GRASS, count: 8 }
    ];
  }

  setSelectedHotbarIndex(index: number): void {
    const wrapped = ((index % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
    this.selectedHotbarIndex = wrapped;
  }

  cycleHotbarSelection(delta: number): void {
    this.setSelectedHotbarIndex(this.selectedHotbarIndex + delta);
  }

  getSelectedBlockId(): number {
    return this.hotbarBlockIds[this.selectedHotbarIndex] ?? BlockId.DIRT;
  }

  assignBlockToSelectedHotbar(blockId: number): void {
    if (blockId === BlockId.AIR) return;
    this.hotbarBlockIds[this.selectedHotbarIndex] = blockId;
  }

  getCount(blockId: number): number {
    const found = this.slots.find((s) => s.blockId === blockId);
    return found ? found.count : 0;
  }

  addItem(blockId: number, amount = 1): boolean {
    if (blockId === BlockId.AIR || amount <= 0) return false;
    const def = getBlockDefinition(blockId);
    if (!def.collectible && blockId !== BlockId.WATER) return false;

    const existing = this.slots.find((s) => s.blockId === blockId);
    if (existing) {
      existing.count += amount;
    } else {
      this.slots.push({ blockId, count: amount });
    }
    return true;
  }

  consumeItem(blockId: number, amount = 1): boolean {
    if (amount <= 0) return true;
    const existing = this.slots.find((s) => s.blockId === blockId);
    if (!existing || existing.count < amount) {
      return false;
    }
    existing.count -= amount;
    return true;
  }

  serialize(): {
    inventory: InventorySlot[];
    hotbarBlockIds: number[];
    selectedHotbarIndex: number;
  } {
    return {
      inventory: this.slots.map((s) => ({ ...s })),
      hotbarBlockIds: [...this.hotbarBlockIds],
      selectedHotbarIndex: this.selectedHotbarIndex
    };
  }
}
