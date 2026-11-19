export const BlockId = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  WATER: 5,
  WOOD: 6,
  LEAVES: 7,
  PLANKS: 8,
  COBBLESTONE: 9,
  GLASS: 10,
  TALL_GRASS: 11,
  FLOWER: 12
} as const;

export type BlockTypeId = (typeof BlockId)[keyof typeof BlockId];

export type BlockCategory = 'terrain' | 'building' | 'nature' | 'fluid';

export interface BlockDefinition {
  id: BlockTypeId;
  name: string;
  solid: boolean;
  transparent: boolean;
  selectableInHotbar: boolean;
  collectible: boolean;
  dropId: BlockTypeId | null;
  category: BlockCategory;
  colors: {
    top: string;
    side: string;
    bottom: string;
  };
  hardness: number;
}

export const CHUNK_SIZE_X = 16;
export const CHUNK_SIZE_Z = 16;
export const WORLD_HEIGHT = 48;
export const SEA_LEVEL = 14;
export const GRAVITY = 28.0;
export const JUMP_VELOCITY = 9.2;
export const WALK_SPEED = 5.4;
export const SPRINT_SPEED = 8.6;
export const REACH_DISTANCE = 6.0;
export const HOTBAR_SIZE = 9;

export const BLOCK_DEFINITIONS: Record<BlockTypeId, BlockDefinition> = {
  [BlockId.AIR]: {
    id: BlockId.AIR,
    name: 'Ar',
    solid: false,
    transparent: true,
    selectableInHotbar: false,
    collectible: false,
    dropId: null,
    category: 'terrain',
    colors: { top: '#000000', side: '#000000', bottom: '#000000' },
    hardness: 0
  },
  [BlockId.GRASS]: {
    id: BlockId.GRASS,
    name: 'Grama',
    solid: true,
    transparent: false,
    selectableInHotbar: true,
    collectible: true,
    dropId: BlockId.DIRT,
    category: 'terrain',
    colors: { top: '#58a832', side: '#7c5230', bottom: '#6d4728' },
    hardness: 0.6
  },
  [BlockId.DIRT]: {
    id: BlockId.DIRT,
    name: 'Terra',
    solid: true,
    transparent: false,
    selectableInHotbar: true,
    collectible: true,
    dropId: BlockId.DIRT,
    category: 'terrain',
    colors: { top: '#7c5230', side: '#7c5230', bottom: '#6d4728' },
    hardness: 0.5
  },
  [BlockId.STONE]: {
    id: BlockId.STONE,
    name: 'Pedra',
    solid: true,
    transparent: false,
    selectableInHotbar: true,
    collectible: true,
    dropId: BlockId.COBBLESTONE,
    category: 'terrain',
    colors: { top: '#80848a', side: '#767a80', bottom: '#686c73' },
    hardness: 1.5
  },
  [BlockId.SAND]: {
    id: BlockId.SAND,
    name: 'Areia',
    solid: true,
    transparent: false,
    selectableInHotbar: true,
    collectible: true,
    dropId: BlockId.SAND,
    category: 'terrain',
    colors: { top: '#e5d38c', side: '#d8c376', bottom: '#c7b060' },
    hardness: 0.5
  },
  [BlockId.WATER]: {
    id: BlockId.WATER,
    name: 'Água',
    solid: false,
    transparent: true,
    selectableInHotbar: true,
    collectible: false,
    dropId: null,
    category: 'fluid',
    colors: { top: '#2b82d9', side: '#2470bf', bottom: '#1d5b9e' },
    hardness: 0
  },
  [BlockId.WOOD]: {
    id: BlockId.WOOD,
    name: 'Madeira de Árvore',
    solid: true,
    transparent: false,
    selectableInHotbar: true,
    collectible: true,
    dropId: BlockId.WOOD,
    category: 'nature',
    colors: { top: '#a87d4b', side: '#5c3b1e', bottom: '#9b7040' },
    hardness: 1.0
  },
  [BlockId.LEAVES]: {
    id: BlockId.LEAVES,
    name: 'Folhas',
    solid: true,
    transparent: true,
    selectableInHotbar: true,
    collectible: true,
    dropId: BlockId.LEAVES,
    category: 'nature',
    colors: { top: '#3f9629', side: '#358222', bottom: '#2b6d1b' },
    hardness: 0.3
  },
  [BlockId.PLANKS]: {
    id: BlockId.PLANKS,
    name: 'Tábuas',
    solid: true,
    transparent: false,
    selectableInHotbar: true,
    collectible: true,
    dropId: BlockId.PLANKS,
    category: 'building',
    colors: { top: '#be8e52', side: '#b48347', bottom: '#a2733b' },
    hardness: 0.8
  },
  [BlockId.COBBLESTONE]: {
    id: BlockId.COBBLESTONE,
    name: 'Pedregulho',
    solid: true,
    transparent: false,
    selectableInHotbar: true,
    collectible: true,
    dropId: BlockId.COBBLESTONE,
    category: 'building',
    colors: { top: '#6d7075', side: '#62656a', bottom: '#54575c' },
    hardness: 1.4
  },
  [BlockId.GLASS]: {
    id: BlockId.GLASS,
    name: 'Vidro',
    solid: true,
    transparent: true,
    selectableInHotbar: true,
    collectible: true,
    dropId: BlockId.GLASS,
    category: 'building',
    colors: { top: '#d6f2ff', side: '#bfe8fc', bottom: '#aedcf2' },
    hardness: 0.3
  },
  [BlockId.TALL_GRASS]: {
    id: BlockId.TALL_GRASS,
    name: 'Mato Alto',
    solid: false,
    transparent: true,
    selectableInHotbar: false,
    collectible: true,
    dropId: BlockId.TALL_GRASS,
    category: 'nature',
    colors: { top: '#63b837', side: '#529e2c', bottom: '#448523' },
    hardness: 0.1
  },
  [BlockId.FLOWER]: {
    id: BlockId.FLOWER,
    name: 'Flor Silvestre',
    solid: false,
    transparent: true,
    selectableInHotbar: true,
    collectible: true,
    dropId: BlockId.FLOWER,
    category: 'nature',
    colors: { top: '#f5d538', side: '#e34b4b', bottom: '#448523' },
    hardness: 0.1
  }
};

export const PLACEABLE_BLOCKS: BlockTypeId[] = Object.values(BLOCK_DEFINITIONS)
  .filter((def) => def.selectableInHotbar)
  .map((def) => def.id);

export function getBlockDefinition(blockId: number): BlockDefinition {
  if (blockId in BLOCK_DEFINITIONS) {
    return BLOCK_DEFINITIONS[blockId as BlockTypeId];
  }
  return BLOCK_DEFINITIONS[BlockId.AIR];
}

export function isBlockSolid(blockId: number): boolean {
  return getBlockDefinition(blockId).solid;
}

export function isBlockTransparent(blockId: number): boolean {
  return getBlockDefinition(blockId).transparent;
}
