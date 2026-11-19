import {
  DEFAULT_GAME_SETTINGS,
  GameSettings,
  SavedWorldData,
  WorldMetadata
} from '../core/gameState.js';
import { CHUNK_SIZE_X, CHUNK_SIZE_Z, WORLD_HEIGHT } from '../core/types.js';

export const WORLD_SAVE_VERSION = 1;
const WORLDS_INDEX_KEY = 'blockworld.worlds.index.v1';
const WORLD_PREFIX = 'blockworld.world.v1.';
const SETTINGS_KEY = 'blockworld.settings.v1';

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

class MemoryStore implements KeyValueStore {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

const fallbackMemoryStore = new MemoryStore();

export function getDefaultStorage(): KeyValueStore {
  try {
    if (typeof globalThis.localStorage !== 'undefined' && globalThis.localStorage !== null) {
      return globalThis.localStorage;
    }
  } catch {
    // Fallback em ambientes sem acesso a localStorage
  }
  return fallbackMemoryStore;
}

export interface IntegrityCheckResult {
  valid: boolean;
  errors: string[];
}

export function validateSavedWorldIntegrity(data: unknown): IntegrityCheckResult {
  const errors: string[] = [];
  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Dados do mundo não são um objeto válido.'] };
  }

  const candidate = data as Partial<SavedWorldData>;
  if (typeof candidate.version !== 'number' || candidate.version < 1) {
    errors.push('Versão do formato de salvamento inválida.');
  }

  const meta = candidate.meta;
  if (!meta || typeof meta !== 'object') {
    errors.push('Metadados do mundo ausentes.');
  } else {
    if (typeof meta.id !== 'string' || meta.id.trim().length === 0) {
      errors.push('ID do mundo ausente.');
    }
    if (typeof meta.name !== 'string' || meta.name.trim().length === 0) {
      errors.push('Nome do mundo ausente.');
    }
    if (typeof meta.seed !== 'string') {
      errors.push('Semente do mundo inválida.');
    }
    const pos = meta.playerPosition;
    if (
      !pos ||
      typeof pos.x !== 'number' ||
      Number.isNaN(pos.x) ||
      typeof pos.y !== 'number' ||
      Number.isNaN(pos.y) ||
      typeof pos.z !== 'number' ||
      Number.isNaN(pos.z)
    ) {
      errors.push('Posição do jogador inválida.');
    }
  }

  if (!Array.isArray(candidate.inventory)) {
    errors.push('Inventário ausente ou malformado.');
  } else {
    for (const slot of candidate.inventory) {
      if (
        !slot ||
        typeof slot.blockId !== 'number' ||
        typeof slot.count !== 'number' ||
        !Number.isFinite(slot.count) ||
        slot.count < 0
      ) {
        errors.push('Slot de inventário inválido encontrado.');
        break;
      }
    }
  }

  if (!Array.isArray(candidate.hotbarBlockIds)) {
    errors.push('Barra rápida (hotbar) ausente ou malformada.');
  }

  const expectedChunkLen = CHUNK_SIZE_X * WORLD_HEIGHT * CHUNK_SIZE_Z;
  if (!Array.isArray(candidate.modifiedChunks)) {
    errors.push('Lista de chunks modificados inválida.');
  } else {
    for (const ch of candidate.modifiedChunks) {
      if (
        !ch ||
        typeof ch.cx !== 'number' ||
        typeof ch.cz !== 'number' ||
        !Array.isArray(ch.blocks) ||
        ch.blocks.length !== expectedChunkLen
      ) {
        errors.push(`Chunk modificado (${ch?.cx ?? '?'}, ${ch?.cz ?? '?'}) com tamanho ou estrutura inválidos.`);
        break;
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export class WorldStorage {
  private readonly store: KeyValueStore;

  constructor(store: KeyValueStore = getDefaultStorage()) {
    this.store = store;
  }

  loadSettings(): GameSettings {
    const raw = this.store.getItem(SETTINGS_KEY);
    if (!raw) {
      return { ...DEFAULT_GAME_SETTINGS };
    }
    try {
      const parsed = JSON.parse(raw) as Partial<GameSettings>;
      return {
        renderDistance:
          typeof parsed.renderDistance === 'number'
            ? Math.max(2, Math.min(5, Math.floor(parsed.renderDistance)))
            : DEFAULT_GAME_SETTINGS.renderDistance,
        fov:
          typeof parsed.fov === 'number'
            ? Math.max(60, Math.min(100, parsed.fov))
            : DEFAULT_GAME_SETTINGS.fov,
        mouseSensitivity:
          typeof parsed.mouseSensitivity === 'number'
            ? Math.max(0.2, Math.min(3.0, parsed.mouseSensitivity))
            : DEFAULT_GAME_SETTINGS.mouseSensitivity,
        shadows: typeof parsed.shadows === 'boolean' ? parsed.shadows : DEFAULT_GAME_SETTINGS.shadows,
        fog: typeof parsed.fog === 'boolean' ? parsed.fog : DEFAULT_GAME_SETTINGS.fog,
        sfxVolume:
          typeof parsed.sfxVolume === 'number'
            ? Math.max(0, Math.min(1, parsed.sfxVolume))
            : DEFAULT_GAME_SETTINGS.sfxVolume,
        muted: typeof parsed.muted === 'boolean' ? parsed.muted : DEFAULT_GAME_SETTINGS.muted
      };
    } catch {
      return { ...DEFAULT_GAME_SETTINGS };
    }
  }

  saveSettings(settings: GameSettings): void {
    this.store.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  listWorlds(): WorldMetadata[] {
    const rawIndex = this.store.getItem(WORLDS_INDEX_KEY);
    if (!rawIndex) {
      return [];
    }
    try {
      const ids = JSON.parse(rawIndex);
      if (!Array.isArray(ids)) return [];
      const list: WorldMetadata[] = [];
      for (const id of ids) {
        if (typeof id !== 'string') continue;
        const loaded = this.loadWorld(id);
        if (loaded) {
          list.push(loaded.meta);
        }
      }
      list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return list;
    } catch {
      return [];
    }
  }

  saveWorld(data: SavedWorldData): { ok: boolean; errors: string[] } {
    const check = validateSavedWorldIntegrity(data);
    if (!check.valid) {
      return { ok: false, errors: check.errors };
    }

    const worldKey = `${WORLD_PREFIX}${data.meta.id}`;
    this.store.setItem(worldKey, JSON.stringify(data));

    const index = this.readIndexIds();
    if (!index.includes(data.meta.id)) {
      index.push(data.meta.id);
      this.store.setItem(WORLDS_INDEX_KEY, JSON.stringify(index));
    }

    return { ok: true, errors: [] };
  }

  loadWorld(worldId: string): SavedWorldData | null {
    const raw = this.store.getItem(`${WORLD_PREFIX}${worldId}`);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as unknown;
      const check = validateSavedWorldIntegrity(parsed);
      if (!check.valid) {
        return null;
      }
      return parsed as SavedWorldData;
    } catch {
      return null;
    }
  }

  deleteWorld(worldId: string): void {
    this.store.removeItem(`${WORLD_PREFIX}${worldId}`);
    const filtered = this.readIndexIds().filter((id) => id !== worldId);
    this.store.setItem(WORLDS_INDEX_KEY, JSON.stringify(filtered));
  }

  private readIndexIds(): string[] {
    const raw = this.store.getItem(WORLDS_INDEX_KEY);
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }
}
