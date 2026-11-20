import { GameState, HudSnapshot } from '../core/gameState.js';
import { BlockId, getBlockDefinition } from '../core/types.js';

export interface HudCallbacks {
  onSelectHotbar: (index: number) => void;
  onAssignHotbarBlock: (slotIndex: number, blockId: number) => void;
  onUpdateSettings: (partial: Partial<GameState['settings']>) => void;
  onSaveWorld: () => void;
  onReturnToMenu: () => void;
  onRequestPointerLock: () => void;
}

export class HudController {
  private readonly root: HTMLElement;
  private readonly callbacks: HudCallbacks;
  private hotbarEl!: HTMLElement;
  private debugEl!: HTMLElement;
  private targetEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private inventoryModalEl!: HTMLElement;
  private settingsModalEl!: HTMLElement;
  private pauseBannerEl!: HTMLElement;
  private debugVisible = false;
  private lastSnapshot: HudSnapshot | null = null;

  constructor(root: HTMLElement, callbacks: HudCallbacks) {
    this.root = root;
    this.callbacks = callbacks;
    this.renderBaseLayout();
    this.bindEvents();
  }

  private renderBaseLayout(): void {
    this.root.innerHTML = `
      <div class="hud-crosshair" aria-hidden="true">+</div>
      <div class="hud-top-bar">
        <div class="hud-pill" id="hud-world-info">BlockWorld</div>
        <div class="hud-actions">
          <button type="button" class="hud-btn" id="hud-btn-inv">Inventário [E]</button>
          <button type="button" class="hud-btn" id="hud-btn-settings">Gráficos [Esc]</button>
          <button type="button" class="hud-btn" id="hud-btn-save">Salvar</button>
          <button type="button" class="hud-btn hud-btn-secondary" id="hud-btn-menu">Menu</button>
        </div>
      </div>
      <div class="hud-target" id="hud-target"></div>
      <div class="hud-debug hidden" id="hud-debug"></div>
      <div class="hud-status hidden" id="hud-status"></div>
      <div class="hud-pause-banner hidden" id="hud-pause-banner">
        <p>Clique na tela para retomar o controle da câmera</p>
        <button type="button" class="hud-btn" id="hud-btn-resume">Continuar</button>
      </div>
      <div class="hud-hotbar" id="hud-hotbar"></div>

      <div class="hud-modal hidden" id="hud-inventory-modal">
        <div class="hud-modal-card">
          <div class="hud-modal-header">
            <h3>Inventário & Hotbar</h3>
            <button type="button" class="hud-close" id="hud-close-inv">×</button>
          </div>
          <p class="hud-hint">Clique em um bloco para equipá-lo no slot ativo da hotbar.</p>
          <div class="hud-inv-grid" id="hud-inv-grid"></div>
        </div>
      </div>

      <div class="hud-modal hidden" id="hud-settings-modal">
        <div class="hud-modal-card">
          <div class="hud-modal-header">
            <h3>Configurações Gráficas & Áudio</h3>
            <button type="button" class="hud-close" id="hud-close-settings">×</button>
          </div>
          <div class="hud-settings-list">
            <label class="hud-row">
              <span>Modo Gráfico</span>
              <select id="hud-opt-quality">
                <option value="performance">Performance (Baixo custo)</option>
                <option value="balanced">Balanced (Equilibrado)</option>
                <option value="ultra">Ultra (Ultrarrealismo)</option>
              </select>
            </label>
            <label class="hud-row">
              <span>Distância de Renderização (<span id="hud-val-rd">4</span> chunks)</span>
              <input type="range" id="hud-opt-rd" min="2" max="8" step="1" value="4" />
            </label>
            <label class="hud-row">
              <span>Campo de Visão / FOV (<span id="hud-val-fov">75</span>°)</span>
              <input type="range" id="hud-opt-fov" min="55" max="100" step="1" value="75" />
            </label>
            <label class="hud-row">
              <span>Sensibilidade do Mouse (<span id="hud-val-sens">1.0</span>)</span>
              <input type="range" id="hud-opt-sens" min="0.2" max="2.5" step="0.1" value="1.0" />
            </label>
            <label class="hud-row">
              <span>Sombras em Tempo Real</span>
              <input type="checkbox" id="hud-opt-shadows" checked />
            </label>
            <label class="hud-row">
              <span>Névoa Atmosférica</span>
              <input type="checkbox" id="hud-opt-fog" checked />
            </label>
            <label class="hud-row">
              <span>Volume SFX (<span id="hud-val-vol">60</span>%)</span>
              <input type="range" id="hud-opt-vol" min="0" max="100" step="5" value="60" />
            </label>
            <label class="hud-row">
              <span>Mudo</span>
              <input type="checkbox" id="hud-opt-mute" />
            </label>
          </div>
        </div>
      </div>
    `;

    this.hotbarEl = this.root.querySelector('#hud-hotbar')!;
    this.debugEl = this.root.querySelector('#hud-debug')!;
    this.targetEl = this.root.querySelector('#hud-target')!;
    this.statusEl = this.root.querySelector('#hud-status')!;
    this.inventoryModalEl = this.root.querySelector('#hud-inventory-modal')!;
    this.settingsModalEl = this.root.querySelector('#hud-settings-modal')!;
    this.pauseBannerEl = this.root.querySelector('#hud-pause-banner')!;
  }

  private bindEvents(): void {
    this.root.querySelector('#hud-btn-inv')!.addEventListener('click', () => this.toggleInventory());
    this.root.querySelector('#hud-close-inv')!.addEventListener('click', () => this.closeModals());
    this.root.querySelector('#hud-btn-settings')!.addEventListener('click', () => this.toggleSettings());
    this.root.querySelector('#hud-close-settings')!.addEventListener('click', () => this.closeModals());
    this.root.querySelector('#hud-btn-save')!.addEventListener('click', () => this.callbacks.onSaveWorld());
    this.root.querySelector('#hud-btn-menu')!.addEventListener('click', () => this.callbacks.onReturnToMenu());
    this.root.querySelector('#hud-btn-resume')!.addEventListener('click', () => {
      this.closeModals();
      this.callbacks.onRequestPointerLock();
    });

    const qualitySel = this.root.querySelector('#hud-opt-quality') as HTMLSelectElement;
    const rdInput = this.root.querySelector('#hud-opt-rd') as HTMLInputElement;
    const fovInput = this.root.querySelector('#hud-opt-fov') as HTMLInputElement;
    const sensInput = this.root.querySelector('#hud-opt-sens') as HTMLInputElement;
    const shadowsInput = this.root.querySelector('#hud-opt-shadows') as HTMLInputElement;
    const fogInput = this.root.querySelector('#hud-opt-fog') as HTMLInputElement;
    const volInput = this.root.querySelector('#hud-opt-vol') as HTMLInputElement;
    const muteInput = this.root.querySelector('#hud-opt-mute') as HTMLInputElement;

    qualitySel.addEventListener('change', () => {
      const mode = qualitySel.value as 'performance' | 'balanced' | 'ultra';
      this.callbacks.onUpdateSettings({ qualityMode: mode });
    });

    rdInput.addEventListener('input', () => {
      const renderDistance = Number(rdInput.value);
      (this.root.querySelector('#hud-val-rd') as HTMLElement).textContent = String(renderDistance);
      this.callbacks.onUpdateSettings({ renderDistance });
    });

    fovInput.addEventListener('input', () => {
      const fov = Number(fovInput.value);
      (this.root.querySelector('#hud-val-fov') as HTMLElement).textContent = String(fov);
      this.callbacks.onUpdateSettings({ fov });
    });

    sensInput.addEventListener('input', () => {
      const mouseSensitivity = Number(sensInput.value);
      (this.root.querySelector('#hud-val-sens') as HTMLElement).textContent = mouseSensitivity.toFixed(1);
      this.callbacks.onUpdateSettings({ mouseSensitivity });
    });

    shadowsInput.addEventListener('change', () => {
      this.callbacks.onUpdateSettings({ shadows: shadowsInput.checked });
    });

    fogInput.addEventListener('change', () => {
      this.callbacks.onUpdateSettings({ fog: fogInput.checked });
    });

    volInput.addEventListener('input', () => {
      const pct = Number(volInput.value);
      (this.root.querySelector('#hud-val-vol') as HTMLElement).textContent = String(pct);
      this.callbacks.onUpdateSettings({ sfxVolume: pct / 100 });
    });

    muteInput.addEventListener('change', () => {
      this.callbacks.onUpdateSettings({ muted: muteInput.checked });
    });
  }

  toggleDebug(): void {
    this.debugVisible = !this.debugVisible;
    this.debugEl.classList.toggle('hidden', !this.debugVisible);
  }

  toggleInventory(): void {
    const isHidden = this.inventoryModalEl.classList.contains('hidden');
    this.closeModals();
    if (isHidden) {
      this.inventoryModalEl.classList.remove('hidden');
      if (document.pointerLockElement) {
        document.exitPointerLock();
      }
      if (this.lastSnapshot) {
        this.renderInventoryGrid(this.lastSnapshot);
      }
    }
  }

  toggleSettings(): void {
    const isHidden = this.settingsModalEl.classList.contains('hidden');
    this.closeModals();
    if (isHidden) {
      this.settingsModalEl.classList.remove('hidden');
      if (document.pointerLockElement) {
        document.exitPointerLock();
      }
      if (this.lastSnapshot) {
        this.syncSettingsInputs(this.lastSnapshot);
      }
    }
  }

  closeModals(): void {
    this.inventoryModalEl.classList.add('hidden');
    this.settingsModalEl.classList.add('hidden');
  }

  hasOpenModal(): boolean {
    return (
      !this.inventoryModalEl.classList.contains('hidden') ||
      !this.settingsModalEl.classList.contains('hidden')
    );
  }

  private syncSettingsInputs(snap: HudSnapshot): void {
    (this.root.querySelector('#hud-opt-quality') as HTMLSelectElement).value = snap.qualityMode;
    (this.root.querySelector('#hud-opt-rd') as HTMLInputElement).value = String(snap.settings.renderDistance);
    (this.root.querySelector('#hud-val-rd') as HTMLElement).textContent = String(snap.settings.renderDistance);
    (this.root.querySelector('#hud-opt-fov') as HTMLInputElement).value = String(snap.settings.fov);
    (this.root.querySelector('#hud-val-fov') as HTMLElement).textContent = String(snap.settings.fov);
    (this.root.querySelector('#hud-opt-sens') as HTMLInputElement).value = String(snap.settings.mouseSensitivity);
    (this.root.querySelector('#hud-val-sens') as HTMLElement).textContent = snap.settings.mouseSensitivity.toFixed(1);
    (this.root.querySelector('#hud-opt-shadows') as HTMLInputElement).checked = snap.settings.shadows;
    (this.root.querySelector('#hud-opt-fog') as HTMLInputElement).checked = snap.settings.fog;
    const volPct = Math.round(snap.settings.sfxVolume * 100);
    (this.root.querySelector('#hud-opt-vol') as HTMLInputElement).value = String(volPct);
    (this.root.querySelector('#hud-val-vol') as HTMLElement).textContent = String(volPct);
    (this.root.querySelector('#hud-opt-mute') as HTMLInputElement).checked = snap.settings.muted;
  }

  private renderInventoryGrid(snap: HudSnapshot): void {
    const grid = this.root.querySelector('#hud-inv-grid')!;
    grid.innerHTML = '';
    for (const slot of snap.inventory) {
      if (slot.blockId === BlockId.AIR) continue;
      const def = getBlockDefinition(slot.blockId);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hud-inv-item';
      btn.innerHTML = `
        <span class="hud-swatch" style="background:${def.colors.top}"></span>
        <span class="hud-inv-name">${def.name}</span>
        <span class="hud-inv-count">x${slot.count}</span>
      `;
      btn.addEventListener('click', () => {
        this.callbacks.onAssignHotbarBlock(snap.selectedSlot, slot.blockId);
        this.closeModals();
      });
      grid.appendChild(btn);
    }
  }

  update(snapshot: HudSnapshot): void {
    this.lastSnapshot = snapshot;

    const infoEl = this.root.querySelector('#hud-world-info') as HTMLElement;
    infoEl.textContent = `${snapshot.worldName} · ${snapshot.qualityMode.toUpperCase()} · Seed: ${snapshot.seed}`;

    if (snapshot.targetBlock) {
      this.targetEl.textContent = `${snapshot.targetBlock.name} (${snapshot.targetBlock.distance.toFixed(1)}m)`;
    } else {
      this.targetEl.textContent = '';
    }

    if (this.debugVisible) {
      this.debugEl.innerHTML = [
        `FPS: ${snapshot.fps}`,
        `Modo: ${snapshot.qualityMode.toUpperCase()}`,
        `Pos: ${snapshot.position.x.toFixed(1)}, ${snapshot.position.y.toFixed(1)}, ${snapshot.position.z.toFixed(1)}`,
        `Chunk: ${snapshot.chunk.cx}, ${snapshot.chunk.cz} (${snapshot.loadedChunks} ativos)`
      ].join('<br/>');
    }

    if (snapshot.statusMessage) {
      this.statusEl.textContent = snapshot.statusMessage;
      this.statusEl.classList.remove('hidden');
    } else {
      this.statusEl.classList.add('hidden');
    }

    const showPause = !snapshot.pointerLocked && !this.hasOpenModal();
    this.pauseBannerEl.classList.toggle('hidden', !showPause);

    this.hotbarEl.innerHTML = '';
    snapshot.hotbarBlockIds.forEach((blockId, idx) => {
      const def = getBlockDefinition(blockId);
      const count = snapshot.inventory.find((s) => s.blockId === blockId)?.count ?? 0;
      const slotEl = document.createElement('button');
      slotEl.type = 'button';
      slotEl.className = `hud-slot ${idx === snapshot.selectedSlot ? 'active' : ''}`;
      slotEl.innerHTML = `
        <span class="hud-slot-key">${idx + 1}</span>
        <span class="hud-swatch" style="background:${def.colors.top}"></span>
        <span class="hud-slot-name">${def.name}</span>
        <span class="hud-slot-count">${count}</span>
      `;
      slotEl.addEventListener('click', () => this.callbacks.onSelectHotbar(idx));
      this.hotbarEl.appendChild(slotEl);
    });
  }

  dispose(): void {
    this.root.innerHTML = '';
  }
}
