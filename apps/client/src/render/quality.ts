import { readStored } from '../storage.ts';

export type QualityName = 'low' | 'medium' | 'high' | 'ultra';

export interface Quality {
  name: QualityName;
  pixelRatio: number;
  oceanN: number;
  oceanRings: number;
  oceanSectors: number;
  shadowMapSize: number;
  shadowDistance: number;
  ao: boolean;
  aoScale: number;
  bloom: boolean;
  traa: boolean;
  ssr: boolean;
  rainDrops: number;
  grassDensity: number;
}

export const QUALITY: Record<QualityName, Quality> = {
  low: {
    name: 'low',
    pixelRatio: 0.75,
    oceanN: 128,
    oceanRings: 220,
    oceanSectors: 320,
    shadowMapSize: 1024,
    shadowDistance: 90,
    ao: false,
    aoScale: 0.5,
    bloom: false,
    traa: true,
    ssr: false,
    rainDrops: 6000,
    grassDensity: 120,
  },
  medium: {
    name: 'medium',
    pixelRatio: 1,
    oceanN: 256,
    oceanRings: 320,
    oceanSectors: 480,
    shadowMapSize: 2048,
    shadowDistance: 140,
    ao: true,
    aoScale: 0.5,
    bloom: true,
    traa: true,
    ssr: false,
    rainDrops: 12000,
    grassDensity: 220,
  },
  high: {
    name: 'high',
    pixelRatio: 1,
    oceanN: 256,
    oceanRings: 420,
    oceanSectors: 720,
    shadowMapSize: 2048,
    shadowDistance: 180,
    ao: true,
    aoScale: 0.5,
    bloom: true,
    traa: true,
    ssr: false,
    rainDrops: 20000,
    grassDensity: 340,
  },
  ultra: {
    name: 'ultra',
    pixelRatio: 1.5,
    oceanN: 512,
    oceanRings: 560,
    oceanSectors: 1024,
    shadowMapSize: 4096,
    shadowDistance: 220,
    ao: true,
    aoScale: 1,
    bloom: true,
    traa: true,
    ssr: true,
    rainDrops: 32000,
    grassDensity: 480,
  },
};

const KEY = 'oilrig.quality';

export function loadQualityName(): QualityName {
  try {
    const v = readStored(KEY);
    if (v && v in QUALITY) return v as QualityName;
  } catch {
    // storage unavailable
  }
  return 'high';
}

export function saveQualityName(q: QualityName) {
  try {
    localStorage.setItem(KEY, q);
  } catch {
    // storage unavailable
  }
}
