// World constants shared by client and server. Units are metres and seconds.
// Axes: +x east, +y up, -z north. Sea level is y = 0.

export const WORLD = {
  // Off the coast of Rio de Janeiro, roughly over the Santos Basin.
  latitude: -23.6,
  longitude: -42.4,
  seaLevel: 0,
  seabed: -30,
} as const;

export const PLAYER = {
  radius: 0.3,
  height: 1.8,
  eyeHeight: 1.65,
  walkSpeed: 3.2,
  runSpeed: 6.0,
  poolSpeedFactor: 0.45,
  jumpSpeed: 4.6,
  gravity: 14.0,
  maxStepHeight: 0.35,
  maxSlopeClimbDeg: 50,
} as const;

export const NET = {
  tickHz: 30,
  snapshotHz: 20,
  poseHz: 20,
  envHz: 1,
  interpolationDelayMs: 110,
  chatMaxLength: 280,
  chatHistory: 50,
  nameMaxLength: 24,
  sessionTtlMs: 10 * 60 * 1000,
} as const;
