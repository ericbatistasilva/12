import { GameSettings, WorldMetadata } from '../core/gameState.js';
import { HOTBAR_SIZE, PLACEABLE_BLOCKS, getBlockDefinition } from '../core/types.js';
import { InventoryManager } from '../inventory/inventoryManager.js';
import { TargetBlockHit } from '../building/blockInteraction.js';

export type ScreenOverlay = 'none' | 'menu' | 'inventory' | 'pause' | 'settings';

export interface HudCallbacks {
  onStartNewWorld: (name: string, seed: string) => void;
  onLoadWorld: (worldId: string) => void;
  onDeleteWorld: (worldId: string) => void;
  onSelectHotbarSlot: (index: number) => void;
  onAssignInventoryBlock: (blockId: number) => void;
  onCloseInventory: () => void;
  onResumeGame: () => void;
  onSaveWorldNow: () => void;
  onOpenSettings: (from: 'menu' | 'pause') => void;
  onCloseSettings: () => void;
  onSaveSettings: (settings: GameSettings) => void;
  onExitToMenu: () => void;
}

function mustGet<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Elemento DOM obrigatório não encontrado: #${id}`);
  }
  return el as T;
}

export class HudController {
  private readonly callbacks: HudCallbacks;
  private statusTimeout: number | null = null;

  private readonly crosshairEl = mustGet<HTMLDivElement>('crosshair');
  private readonly hudTopEl = mustGet<HTMLDivElement>('hud-top');
  private readonly hotbarContainerEl = mustGet<HTMLDivElement>('hotbar-container');
  private readonly hotbarSlotsEl = mustGet<HTMLDivElement>('hotbar-slots');

  private readonly hudWorldNameEl = mustGet<HTMLSpanElement>('hud-world-name');
  private readonly hudCoordsEl = mustGet<HTMLSpanElement>('hud-coords');
  private readonly hudBiomeEl = mustGet<HTMLSpanElement>('hud-biome');
  private readonly hudTargetBlockEl = mustGet<HTMLDivElement>('hud-target-block');
  private readonly hudStatusMsgEl = mustGet<HTMLDivElement>('hud-status-msg');

  private readonly menuScreenEl = mustGet<HTMLElement>('menu-screen');
  private readonly inventoryScreenEl = mustGet<HTMLElement>('inventory-screen');
  private readonly pauseScreenEl = mustGet<HTMLElement>('pause-screen');
  private readonly settingsScreenEl = mustGet<HTMLElement>('settings-screen');

  private readonly worldNameInput = mustGet<HTMLInputElement>('world-name-input');
  private readonly worldSeedInput = mustGet<HTMLInputElement>('world-seed-input');
  private readonly savedWorldsListEl = mustGet<HTMLDivElement>('saved-worlds-list');
  private readonly inventoryGridEl = mustGet<HTMLDivElement>('inventory-grid');

  private readonly renderDistanceSelect = mustGet<HTMLSelectElement>('render-distance-select');
  private readonly fovRange = mustGet<HTMLInputElement>('fov-range');
  private readonly fovValue = mustGet<HTMLSpanElement>('fov-value');
  private readonly sensitivityRange = mustGet<HTMLInputElement>('sensitivity-range');
  private readonly sensitivityValue = mustGet<HTMLSpanElement>('sensitivity-value');
  private readonly shadowsToggle = mustGet<HTMLInputElement>('shadows-toggle');
  private readonly fogToggle = mustGet<HTMLInputElement>('fog-toggle');
  private readonly sfxVolumeRange = mustGet<HTMLInputElement>('sfx-volume-range');
  private readonly sfxVolumeValue = mustGet<HTMLSpanElement>('sfx-volume-value');
  private readonly sfxMuteToggle = mustGet<HTMLInputElement>('sfx-mute-toggle');

  constructor(callbacks: HudCallbacks) {
    this.callbacks = callbacks;
    this.bindEvents();
  }

  private bindEvents(): void {
    mustGet<HTMLButtonElement>('random-seed-btn').addEventListener('click', () => {
      const randomNum = Math.floor(100000 + Math.random() * 900000);
      this.worldSeedInput.value = `BW-${randomNum}`;
    });

    mustGet<HTMLButtonElement>('start-new-world-btn').addEventListener('click', () => {
      const name = this.worldNameInput.value.trim() || 'Novo Mundo';
      const seed = this.worldSeedInput.value.trim() || `seed-${Date.now()}`;
      this.callbacks.onStartNewWorld(name, seed);
    });

    mustGet<HTMLButtonElement>('open-menu-settings-btn').addEventListener('click', () => {
      this.callbacks.onOpenSettings('menu');
    });

    mustGet<HTMLButtonElement>('open-pause-settings-btn').addEventListener('click', () => {
      this.callbacks.onOpenSettings('pause');
    });

    mustGet<HTMLButtonElement>('close-inventory-btn').addEventListener('click', () => {
      this.callbacks.onCloseInventory();
    });

    mustGet<HTMLButtonElement>('resume-game-btn').addEventListener('click', () => {
      this.callbacks.onResumeGame();
    });

    mustGet<HTMLButtonElement>('save-world-btn').addEventListener('click', () => {
      this.callbacks.onSaveWorldNow();
    });

    mustGet<HTMLButtonElement>('exit-to-menu-btn').addEventListener('click', () => {
      this.callbacks.onExitToMenu();
    });

    mustGet<HTMLButtonElement>('close-settings-btn').addEventListener('click', () => {
      this.callbacks.onCloseSettings();
    });

    this.fovRange.addEventListener('input', () => {
      this.fovValue.textContent = `${this.fovRange.value}°`;
    });

    this.sensitivityRange.addEventListener('input', () => {
      this.sensitivityValue.textContent = `${Number(this.sensitivityRange.value).toFixed(1)}x`;
    });

    this.sfxVolumeRange.addEventListener('input', () => {
      this.sfxVolumeValue.textContent = `${this.sfxVolumeRange.value}%`;
    });

    mustGet<HTMLButtonElement>('save-settings-btn').addEventListener('click', () => {
      const updated: GameSettings = {
        renderDistance: Number(this.renderDistanceSelect.value) || 3,
        fov: Number(this.fovRange.value) || 75,
        mouseSensitivity: Number(this.sensitivityRange.value) || 1.0,
        shadows: this.shadowsToggle.checked,
        fog: this.fogToggle.checked,
        sfxVolume: (Number(this.sfxVolumeRange.value) || 0) / 100,
        muted: this.sfxMuteToggle.checked
      };
      this.callbacks.onSaveSettings(updated);
    });
  }

  setScreen(screen: ScreenOverlay, inGame: boolean): void {
    this.menuScreenEl.classList.toggle('hidden', screen !== 'menu');
    this.menuScreenEl.classList.toggle('active', screen === 'menu');

    this.inventoryScreenEl.classList.toggle('hidden', screen !== 'inventory');
    this.inventoryScreenEl.classList.toggle('active', screen === 'inventory');

    this.pauseScreenEl.classList.toggle('hidden', screen !== 'pause');
    this.pauseScreenEl.classList.toggle('active', screen === 'pause');

    this.settingsScreenEl.classList.toggle('hidden', screen !== 'settings');
    this.settingsScreenEl.classList.toggle('active', screen === 'settings');

    const showHud = inGame && screen === 'none';
    this.crosshairEl.classList.toggle('hidden', !showHud);
    this.hudTopEl.classList.toggle('hidden', !showHud);
    this.hotbarContainerEl.classList.toggle('hidden', !showHud);
  }

  populateSettingsForm(settings: GameSettings): void {
    this.renderDistanceSelect.value = String(settings.renderDistance);
    this.fovRange.value = String(settings.fov);
    this.fovValue.textContent = `${settings.fov}°`;
    this.sensitivityRange.value = String(settings.mouseSensitivity);
    this.sensitivityValue.textContent = `${settings.mouseSensitivity.toFixed(1)}x`;
    this.shadowsToggle.checked = settings.shadows;
    this.fogToggle.checked = settings.fog;
    const pct = Math.round(settings.sfxVolume * 100);
    this.sfxVolumeRange.value = String(pct);
    this.sfxVolumeValue.textContent = `${pct}%`;
    this.sfxMuteToggle.checked = settings.muted;
  }

  renderSavedWorlds(worlds: WorldMetadata[]): void {
    this.savedWorldsListEl.innerHTML = '';
    if (worlds.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-worlds';
      empty.textContent = 'Nenhum mundo salvo ainda. Crie um novo mundo acima para começar.';
      this.savedWorldsListEl.appendChild(empty);
      return;
    }

    for (const world of worlds) {
      const card = document.createElement('div');
      card.className = 'world-card';

      const info = document.createElement('div');
      info.className = 'world-card-info';
      const title = document.createElement('strong');
      title.textContent = world.name;
      const meta = document.createElement('span');
      const dateStr = new Date(world.updatedAt).toLocaleString('pt-BR');
      meta.textContent = `Semente: ${world.seed} • Atualizado: ${dateStr}`;
      info.appendChild(title);
      info.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'world-card-actions';

      const loadBtn = document.createElement('button');
      loadBtn.type = 'button';
      loadBtn.className = 'btn btn-primary btn-sm';
      loadBtn.textContent = 'Jogar';
      loadBtn.addEventListener('click', () => this.callbacks.onLoadWorld(world.id));

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn btn-danger btn-sm';
      delBtn.textContent = 'Excluir';
      delBtn.addEventListener('click', () => this.callbacks.onDeleteWorld(world.id));

      actions.appendChild(loadBtn);
      actions.appendChild(delBtn);

      card.appendChild(info);
      card.appendChild(actions);
      this.savedWorldsListEl.appendChild(card);
    }
  }

  renderHotbar(inventory: InventoryManager): void {
    this.hotbarSlotsEl.innerHTML = '';

    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const blockId = inventory.hotbarBlockIds[i];
      const def = getBlockDefinition(blockId);
      const count = inventory.getCount(blockId);

      const slotBtn = document.createElement('button');
      slotBtn.type = 'button';
      slotBtn.className = `hotbar-slot ${i === inventory.selectedHotbarIndex ? 'selected' : ''}`;
      slotBtn.title = `${def.name} (${count})`;

      const keyBadge = document.createElement('span');
      keyBadge.className = 'slot-key';
      keyBadge.textContent = String((i + 1) % 10);

      const swatch = document.createElement('span');
      swatch.className = 'block-swatch';
      swatch.style.background = `linear-gradient(135deg, ${def.colors.top} 45%, ${def.colors.side} 45%)`;

      const label = document.createElement('span');
      label.className = 'slot-name';
      label.textContent = def.name;

      const countBadge = document.createElement('span');
      countBadge.className = 'slot-count';
      countBadge.textContent = String(count);

      slotBtn.appendChild(keyBadge);
      slotBtn.appendChild(swatch);
      slotBtn.appendChild(label);
      slotBtn.appendChild(countBadge);

      slotBtn.addEventListener('click', () => {
        this.callbacks.onSelectHotbarSlot(i);
      });

      this.hotbarSlotsEl.appendChild(slotBtn);
    }
  }

  renderInventoryModal(inventory: InventoryManager): void {
    this.inventoryGridEl.innerHTML = '';
    const selectedBlockId = inventory.getSelectedBlockId();

    const blockIds = Array.from(new Set([...PLACEABLE_BLOCKS, ...inventory.slots.map((s) => s.blockId)]));

    for (const blockId of blockIds) {
      const def = getBlockDefinition(blockId);
      const count = inventory.getCount(blockId);

      const itemBtn = document.createElement('button');
      itemBtn.type = 'button';
      itemBtn.className = `inv-item ${blockId === selectedBlockId ? 'active-slot' : ''}`;

      const swatch = document.createElement('span');
      swatch.className = 'block-swatch large';
      swatch.style.background = `linear-gradient(135deg, ${def.colors.top} 45%, ${def.colors.side} 45%)`;

      const nameEl = document.createElement('span');
      nameEl.className = 'inv-name';
      nameEl.textContent = def.name;

      const countEl = document.createElement('span');
      countEl.className = 'inv-count';
      countEl.textContent = `Qtd: ${count}`;

      itemBtn.appendChild(swatch);
      itemBtn.appendChild(nameEl);
      itemBtn.appendChild(countEl);

      itemBtn.addEventListener('click', () => {
        this.callbacks.onAssignInventoryBlock(blockId);
      });

      this.inventoryGridEl.appendChild(itemBtn);
    }
  }

  updateHudTelemetry(
    worldName: string,
    x: number,
    y: number,
    z: number,
    biome: string,
    target: TargetBlockHit | null
  ): void {
    this.hudWorldNameEl.textContent = worldName;
    this.hudCoordsEl.textContent = `X: ${x.toFixed(1)} | Y: ${y.toFixed(1)} | Z: ${z.toFixed(1)}`;
    this.hudBiomeEl.textContent = `Bioma: ${biome}`;

    if (target) {
      const def = getBlockDefinition(target.blockId);
      this.hudTargetBlockEl.textContent = `Alvo: ${def.name} (${target.blockPos.x}, ${target.blockPos.y}, ${target.blockPos.z})`;
    } else {
      this.hudTargetBlockEl.textContent = 'Nenhum bloco alvo';
    }
  }

  showToast(message: string, durationMs = 2000): void {
    this.hudStatusMsgEl.textContent = message;
    this.hudStatusMsgEl.classList.remove('hidden');

    if (this.statusTimeout !== null) {
      window.clearTimeout(this.statusTimeout);
    }
    this.statusTimeout = window.setTimeout(() => {
      this.hudStatusMsgEl.classList.add('hidden');
      this.statusTimeout = null;
    }, durationMs);
  }
}
