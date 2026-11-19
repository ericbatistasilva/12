import * as THREE from 'three';
import { GameSettings } from '../core/gameState.js';
import { TargetBlockHit } from '../building/blockInteraction.js';

const SKY_COLOR = 0x87c6f5;

export class GameEngine {
  public readonly canvas: HTMLCanvasElement;
  public readonly renderer: THREE.WebGLRenderer;
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly opaqueMaterial: THREE.MeshLambertMaterial;
  public readonly transparentMaterial: THREE.MeshLambertMaterial;
  private readonly dirLight: THREE.DirectionalLight;
  private readonly fog: THREE.FogExp2;
  private readonly selectionBox: THREE.LineSegments;

  constructor(canvas: HTMLCanvasElement, initialSettings: GameSettings) {
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'default'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth || 800, window.innerHeight || 600, false);
    this.renderer.shadowMap.enabled = initialSettings.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SKY_COLOR);

    this.fog = new THREE.FogExp2(SKY_COLOR, initialSettings.fog ? 0.022 : 0);
    this.scene.fog = this.fog;

    this.camera = new THREE.PerspectiveCamera(
      initialSettings.fov,
      (window.innerWidth || 800) / (window.innerHeight || 600),
      0.1,
      180
    );

    const hemiLight = new THREE.HemisphereLight(0xdff2ff, 0x4b5d3b, 0.85);
    this.scene.add(hemiLight);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.25);
    this.scene.add(ambientLight);

    this.dirLight = new THREE.DirectionalLight(0xfff6e0, 1.35);
    this.dirLight.position.set(45, 75, 35);
    this.dirLight.castShadow = initialSettings.shadows;
    this.dirLight.shadow.mapSize.width = 1024;
    this.dirLight.shadow.mapSize.height = 1024;
    this.dirLight.shadow.camera.near = 5;
    this.dirLight.shadow.camera.far = 200;
    const d = 42;
    this.dirLight.shadow.camera.left = -d;
    this.dirLight.shadow.camera.right = d;
    this.dirLight.shadow.camera.top = d;
    this.dirLight.shadow.camera.bottom = -d;
    this.scene.add(this.dirLight);

    this.opaqueMaterial = new THREE.MeshLambertMaterial({
      vertexColors: true
    });

    this.transparentMaterial = new THREE.MeshLambertMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.78,
      depthWrite: false
    });

    // Contorno wireframe do bloco selecionado pelo raycast
    const boxGeom = new THREE.BoxGeometry(1.006, 1.006, 1.006);
    const edgesGeom = new THREE.EdgesGeometry(boxGeom);
    boxGeom.dispose();
    const edgesMat = new THREE.LineBasicMaterial({ color: 0x111827 });
    this.selectionBox = new THREE.LineSegments(edgesGeom, edgesMat);
    this.selectionBox.visible = false;
    this.scene.add(this.selectionBox);
  }

  applySettings(settings: GameSettings): void {
    this.camera.fov = settings.fov;
    this.camera.updateProjectionMatrix();

    this.fog.density = settings.fog ? 0.022 : 0;
    this.renderer.shadowMap.enabled = settings.shadows;
    this.dirLight.castShadow = settings.shadows;
    this.renderer.shadowMap.needsUpdate = true;
  }

  updateTargetHighlight(target: TargetBlockHit | null): void {
    if (!target) {
      this.selectionBox.visible = false;
      return;
    }
    this.selectionBox.visible = true;
    this.selectionBox.position.set(
      target.blockPos.x + 0.5,
      target.blockPos.y + 0.5,
      target.blockPos.z + 0.5
    );
  }

  syncSunWithPlayer(playerX: number, playerZ: number): void {
    this.dirLight.position.set(playerX + 36, 72, playerZ + 28);
    this.dirLight.target.position.set(playerX, 12, playerZ);
    this.dirLight.target.updateMatrixWorld();
  }

  resize(width: number, height: number): void {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.opaqueMaterial.dispose();
    this.transparentMaterial.dispose();
    this.selectionBox.geometry.dispose();
    (this.selectionBox.material as THREE.Material).dispose();
    this.renderer.dispose();
  }
}
