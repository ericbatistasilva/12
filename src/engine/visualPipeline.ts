import * as THREE from 'three';

export type QualityPreset = 'performance' | 'balanced' | 'ultra';

export interface QualityProfile {
  preset: QualityPreset;
  pixelRatioCap: number;
  shadowEnabled: boolean;
  shadowMapSize: number;
  shadowRadius: number;
  fogEnabled: boolean;
  fogDensity: number;
  toneMappingExposure: number;
  hemiIntensity: number;
  dirLightIntensity: number;
  opaqueRoughness: number;
  opaqueMetalness: number;
  transparentOpacity: number;
  transparentRoughness: number;
  transparentMetalness: number;
  waterWaveAmplitude: number;
  waterWaveSpeed: number;
  foliageSwayAmplitude: number;
  foliageSwaySpeed: number;
  skyZenithColor: number;
  skyHorizonColor: number;
  sunDiscIntensity: number;
}

export interface VisualPreferenceInput {
  shadows?: boolean;
  fog?: boolean;
}

export interface EffectiveVisualFlags {
  shadowsEnabled: boolean;
  fogEnabled: boolean;
}

export function normalizeQualityPreset(raw?: string | null): QualityPreset {
  if (raw === 'performance' || raw === 'balanced' || raw === 'ultra') {
    return raw;
  }
  return 'balanced';
}

export function getQualityProfile(preset: QualityPreset): QualityProfile {
  switch (preset) {
    case 'performance':
      return {
        preset: 'performance',
        pixelRatioCap: 1.0,
        shadowEnabled: false,
        shadowMapSize: 512,
        shadowRadius: 1,
        fogEnabled: true,
        fogDensity: 0.015,
        toneMappingExposure: 1.0,
        hemiIntensity: 0.96,
        dirLightIntensity: 1.22,
        opaqueRoughness: 0.9,
        opaqueMetalness: 0.02,
        transparentOpacity: 0.82,
        transparentRoughness: 0.58,
        transparentMetalness: 0.04,
        waterWaveAmplitude: 0.018,
        waterWaveSpeed: 1.35,
        foliageSwayAmplitude: 0.008,
        foliageSwaySpeed: 1.15,
        skyZenithColor: 0x7aa9d8,
        skyHorizonColor: 0xb7d4ee,
        sunDiscIntensity: 0.55
      };
    case 'ultra':
      return {
        preset: 'ultra',
        pixelRatioCap: 2.0,
        shadowEnabled: true,
        shadowMapSize: 2048,
        shadowRadius: 2.5,
        fogEnabled: true,
        fogDensity: 0.0095,
        toneMappingExposure: 1.08,
        hemiIntensity: 1.02,
        dirLightIntensity: 1.52,
        opaqueRoughness: 0.84,
        opaqueMetalness: 0.05,
        transparentOpacity: 0.76,
        transparentRoughness: 0.34,
        transparentMetalness: 0.12,
        waterWaveAmplitude: 0.045,
        waterWaveSpeed: 2.15,
        foliageSwayAmplitude: 0.022,
        foliageSwaySpeed: 1.75,
        skyZenithColor: 0x3f78b8,
        skyHorizonColor: 0xc9e1f6,
        sunDiscIntensity: 1.0
      };
    case 'balanced':
    default:
      return {
        preset: 'balanced',
        pixelRatioCap: 1.5,
        shadowEnabled: true,
        shadowMapSize: 1024,
        shadowRadius: 1.75,
        fogEnabled: true,
        fogDensity: 0.012,
        toneMappingExposure: 1.04,
        hemiIntensity: 0.94,
        dirLightIntensity: 1.35,
        opaqueRoughness: 0.86,
        opaqueMetalness: 0.04,
        transparentOpacity: 0.78,
        transparentRoughness: 0.46,
        transparentMetalness: 0.08,
        waterWaveAmplitude: 0.03,
        waterWaveSpeed: 1.75,
        foliageSwayAmplitude: 0.015,
        foliageSwaySpeed: 1.45,
        skyZenithColor: 0x5c91c9,
        skyHorizonColor: 0xbdd8f0,
        sunDiscIntensity: 0.8
      };
  }
}

export function resolveEffectiveVisualFlags(
  preferences: VisualPreferenceInput,
  profile: QualityProfile
): EffectiveVisualFlags {
  const userShadows = preferences.shadows ?? true;
  const userFog = preferences.fog ?? true;
  return {
    shadowsEnabled: userShadows && profile.shadowEnabled,
    fogEnabled: userFog && profile.fogEnabled
  };
}

export interface SkyDomeRig {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  uniforms: {
    uZenithColor: { value: THREE.Color };
    uHorizonColor: { value: THREE.Color };
    uSunDirection: { value: THREE.Vector3 };
    uSunIntensity: { value: number };
    uTime: { value: number };
  };
  dispose(): void;
}

export function createAtmosphericSkyDome(profile: QualityProfile): SkyDomeRig {
  const uniforms = {
    uZenithColor: { value: new THREE.Color(profile.skyZenithColor) },
    uHorizonColor: { value: new THREE.Color(profile.skyHorizonColor) },
    uSunDirection: { value: new THREE.Vector3(28, 46, 22).normalize() },
    uSunIntensity: { value: profile.sunDiscIntensity },
    uTime: { value: 0 }
  };

  const geometry = new THREE.SphereGeometry(140, 24, 16);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vDomeDir;
      void main() {
        // Direcao relativa ao centro local do domo, sem incorporar a translacao do mesh
        vDomeDir = normalize(position);
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenithColor;
      uniform vec3 uHorizonColor;
      uniform vec3 uSunDirection;
      uniform float uSunIntensity;
      uniform float uTime;
      varying vec3 vDomeDir;

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      float cloudNoise(vec2 uv) {
        vec2 i = floor(uv);
        vec2 f = fract(uv);
        vec2 u = f * f * (3.0 - 2.0 * f);
        float a = hash21(i);
        float b = hash21(i + vec2(1.0, 0.0));
        float c = hash21(i + vec2(0.0, 1.0));
        float d = hash21(i + vec2(1.0, 1.0));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }

      float fbmClouds(vec2 uv) {
        float n = 0.0;
        float amp = 0.5;
        for (int i = 0; i < 3; i++) {
          n += amp * cloudNoise(uv);
          uv = uv * 2.03 + vec2(13.7, 7.1);
          amp *= 0.5;
        }
        return n;
      }

      void main() {
        vec3 dir = normalize(vDomeDir);
        float h = clamp(dir.y, 0.0, 1.0);
        float horizonBlend = pow(1.0 - h, 2.2);
        vec3 sky = mix(uZenithColor, uHorizonColor, horizonBlend);

        vec3 sunDir = normalize(uSunDirection);
        float sunDot = max(dot(dir, sunDir), 0.0);
        float mieGlow = pow(sunDot, 12.0) * 0.28 * uSunIntensity;
        float sunDisc = smoothstep(0.9985, 0.9996, sunDot) * 1.45 * uSunIntensity;
        sky += vec3(1.0, 0.93, 0.78) * (mieGlow + sunDisc);

        if (dir.y > 0.04) {
          vec2 cloudUv = dir.xz / (dir.y + 0.18) * 1.35 + vec2(uTime * 0.012, uTime * 0.006);
          float c = fbmClouds(cloudUv);
          float cloudMask = smoothstep(0.56, 0.82, c) * smoothstep(0.04, 0.28, dir.y);
          float lightFacing = clamp(0.65 + 0.35 * dot(normalize(vec3(dir.x, 0.35, dir.z)), sunDir), 0.45, 1.15);
          vec3 cloudLit = mix(uHorizonColor * 0.92, vec3(1.0, 0.99, 0.97), lightFacing);
          sky = mix(sky, cloudLit, cloudMask * 0.52);
        }

        gl_FragColor = vec4(sky, 1.0);
      }
    `
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  return {
    mesh,
    material,
    uniforms,
    dispose() {
      geometry.dispose();
      material.dispose();
    }
  };
}

export function applyAnimatedMaterialShader(
  material: THREE.MeshStandardMaterial,
  timeUniform: { value: number },
  waveAmplitudeUniform: { value: number },
  waveSpeedUniform: { value: number },
  foliageAmplitudeUniform: { value: number },
  foliageSpeedUniform: { value: number },
  cacheKey: string
): void {
  material.customProgramCacheKey = () => cacheKey;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeUniform;
    shader.uniforms.uWaterAmp = waveAmplitudeUniform;
    shader.uniforms.uWaterSpeed = waveSpeedUniform;
    shader.uniforms.uFoliageAmp = foliageAmplitudeUniform;
    shader.uniforms.uFoliageSpeed = foliageSpeedUniform;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform float uTime;
        uniform float uWaterAmp;
        uniform float uWaterSpeed;
        uniform float uFoliageAmp;
        uniform float uFoliageSpeed;
        attribute float aAnimKind;
        attribute float aAnimWeight;
        varying float vAnimKind;
        varying float vAnimWeight;
        varying vec3 vWorldPosAnim;
        `
      )
      .replace(
        '#include <beginnormal_vertex>',
        /* glsl */ `
        #include <beginnormal_vertex>
        float animWeightSafe = clamp(aAnimWeight, 0.0, 1.0);
        if (aAnimKind > 0.5 && aAnimKind < 1.5 && animWeightSafe > 0.0001) {
          vec4 worldNormPos = modelMatrix * vec4(position, 1.0);
          float phase1 = worldNormPos.x * 0.65 + worldNormPos.z * 0.55 + uTime * uWaterSpeed;
          float phase2 = worldNormPos.x * 1.3 - worldNormPos.z * 1.1 + uTime * uWaterSpeed * 1.35;
          // Derivadas parciais exatas de wave(x, z) = sin(phase1) + 0.5 * cos(phase2)
          float dWaveWorldDx = (0.65 * cos(phase1) - 0.65 * sin(phase2)) * uWaterAmp * animWeightSafe;
          float dWaveWorldDz = (0.55 * cos(phase1) + 0.55 * sin(phase2)) * uWaterAmp * animWeightSafe;
          vec3 perturbedWorldNormal = normalize(vec3(-dWaveWorldDx, 1.0, -dWaveWorldDz));
          mat3 worldToLocal = mat3(
            normalize(modelMatrix[0].xyz),
            normalize(modelMatrix[1].xyz),
            normalize(modelMatrix[2].xyz)
          );
          vec3 perturbedLocalNormal = normalize(transpose(worldToLocal) * perturbedWorldNormal);
          objectNormal = normalize(mix(objectNormal, perturbedLocalNormal, animWeightSafe));
        }
        `
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        vAnimKind = aAnimKind;
        vAnimWeight = clamp(aAnimWeight, 0.0, 1.0);
        vec4 worldBase = modelMatrix * vec4(transformed, 1.0);
        if (aAnimKind > 0.5 && aAnimKind < 1.5) {
          float wave = sin(worldBase.x * 0.65 + worldBase.z * 0.55 + uTime * uWaterSpeed)
                     + 0.5 * cos(worldBase.x * 1.3 - worldBase.z * 1.1 + uTime * uWaterSpeed * 1.35);
          transformed.y += wave * uWaterAmp * vAnimWeight;
        } else if (aAnimKind > 1.5) {
          float sway = sin(worldBase.x * 0.9 + worldBase.y * 1.4 + worldBase.z * 0.7 + uTime * uFoliageSpeed);
          transformed.x += sway * uFoliageAmp * vAnimWeight;
          transformed.z += cos(worldBase.z * 0.85 + worldBase.y * 1.2 + worldBase.x * 0.6 + uTime * uFoliageSpeed * 0.9) * uFoliageAmp * 0.7 * vAnimWeight;
        }
        vWorldPosAnim = (modelMatrix * vec4(transformed, 1.0)).xyz;
        `
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform float uTime;
        uniform float uWaterSpeed;
        varying float vAnimKind;
        varying float vAnimWeight;
        varying vec3 vWorldPosAnim;
        `
      )
      .replace(
        '#include <dithering_fragment>',
        /* glsl */ `
        if (vAnimKind > 0.5 && vAnimKind < 1.5 && vAnimWeight > 0.0001) {
          vec3 viewDirW = normalize(cameraPosition - vWorldPosAnim);
          vec3 upN = normalize(vec3(
            sin(vWorldPosAnim.x * 1.7 + uTime * uWaterSpeed * 1.4) * 0.08 * vAnimWeight,
            1.0,
            cos(vWorldPosAnim.z * 1.6 + uTime * uWaterSpeed * 1.2) * 0.08 * vAnimWeight
          ));
          float fresnel = pow(1.0 - max(dot(viewDirW, upN), 0.0), 3.2);
          float shimmer = smoothstep(0.68, 0.94, sin(vWorldPosAnim.x * 3.1 + vWorldPosAnim.z * 2.7 - uTime * uWaterSpeed * 2.0) * 0.5 + 0.5);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb + vec3(0.24, 0.34, 0.42), clamp((fresnel * 0.55 + shimmer * 0.14) * vAnimWeight, 0.0, 0.65));
        }
        #include <dithering_fragment>
        `
      );
  };
  material.needsUpdate = true;
}
