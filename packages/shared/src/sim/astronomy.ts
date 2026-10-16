// Sun position after the NOAA solar calculator equations; moon position and
// illumination after the low-precision formulas popularised by suncalc
// (Agafonkin, BSD-2), themselves from Meeus' "Astronomical Algorithms".

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export interface SkyPosition {
  /** Degrees above the horizon (geometric, no refraction). */
  elevation: number;
  /** Degrees clockwise from north. */
  azimuth: number;
}

export function julianDay(ms: number): number {
  return ms / 86400000 + 2440587.5;
}

interface SolarTerms {
  declination: number; // degrees
  equationOfTime: number; // minutes
}

function solarTerms(ms: number): SolarTerms {
  const jc = (julianDay(ms) - 2451545) / 36525;
  const l0 = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360;
  const m = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
  const c =
    Math.sin(m * RAD) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
    Math.sin(2 * m * RAD) * (0.019993 - 0.000101 * jc) +
    Math.sin(3 * m * RAD) * 0.000289;
  const trueLong = l0 + c;
  const omega = 125.04 - 1934.136 * jc;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const meanObliq = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const obliq = meanObliq + 0.00256 * Math.cos(omega * RAD);
  const declination = Math.asin(Math.sin(obliq * RAD) * Math.sin(appLong * RAD)) * DEG;
  const y = Math.tan((obliq / 2) * RAD) ** 2;
  const eot =
    4 *
    DEG *
    (y * Math.sin(2 * l0 * RAD) -
      2 * e * Math.sin(m * RAD) +
      4 * e * y * Math.sin(m * RAD) * Math.cos(2 * l0 * RAD) -
      0.5 * y * y * Math.sin(4 * l0 * RAD) -
      1.25 * e * e * Math.sin(2 * m * RAD));
  return { declination, equationOfTime: eot };
}

export function equationOfTime(ms: number): number {
  return solarTerms(ms).equationOfTime;
}

export function sunPosition(ms: number, latitude: number, longitude: number): SkyPosition {
  const { declination, equationOfTime: eot } = solarTerms(ms);
  const d = new Date(ms);
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60 + d.getUTCMilliseconds() / 60000;
  let tst = (minutes + eot + 4 * longitude) % 1440;
  if (tst < 0) tst += 1440;
  const ha = tst / 4 < 0 ? tst / 4 + 180 : tst / 4 - 180;
  const lat = latitude * RAD;
  const dec = declination * RAD;
  const cosZen = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha * RAD);
  const zenith = Math.acos(Math.min(1, Math.max(-1, cosZen)));
  const sinZen = Math.sin(zenith);
  let azimuth: number;
  if (sinZen < 1e-9) {
    azimuth = 180;
  } else {
    const cosAz = (Math.sin(lat) * Math.cos(zenith) - Math.sin(dec)) / (Math.cos(lat) * sinZen);
    const a = Math.acos(Math.min(1, Math.max(-1, cosAz))) * DEG;
    azimuth = ha > 0 ? (a + 180) % 360 : (540 - a) % 360;
  }
  return { elevation: 90 - zenith * DEG, azimuth };
}

// ---- Moon ----

const E = 23.4397 * RAD;
const rightAscension = (l: number, b: number) => Math.atan2(Math.sin(l) * Math.cos(E) - Math.tan(b) * Math.sin(E), Math.cos(l));
const declinationOf = (l: number, b: number) => Math.asin(Math.sin(b) * Math.cos(E) + Math.cos(b) * Math.sin(E) * Math.sin(l));

function daysSinceJ2000(ms: number) {
  return julianDay(ms) - 2451545;
}

function moonCoords(d: number) {
  const L = RAD * (218.316 + 13.176396 * d);
  const M = RAD * (134.963 + 13.064993 * d);
  const F = RAD * (93.272 + 13.22935 * d);
  const l = L + RAD * 6.289 * Math.sin(M);
  const b = RAD * 5.128 * Math.sin(F);
  return { ra: rightAscension(l, b), dec: declinationOf(l, b), dist: 385001 - 20905 * Math.cos(M) };
}

function sunCoords(d: number) {
  const M = RAD * (357.5291 + 0.98560028 * d);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;
  return { ra: rightAscension(L, 0), dec: declinationOf(L, 0) };
}

/** Local sidereal time in radians. */
export function localSiderealTime(ms: number, longitude: number): number {
  return RAD * (280.16 + 360.9856235 * daysSinceJ2000(ms)) + longitude * RAD;
}

export function moonPosition(ms: number, latitude: number, longitude: number): SkyPosition & { illumination: number } {
  const d = daysSinceJ2000(ms);
  const m = moonCoords(d);
  const phi = latitude * RAD;
  const H = localSiderealTime(ms, longitude) - m.ra;
  const alt = Math.asin(Math.sin(phi) * Math.sin(m.dec) + Math.cos(phi) * Math.cos(m.dec) * Math.cos(H));
  const azSouth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(m.dec) * Math.cos(phi));
  const s = sunCoords(d);
  const sdist = 149598000;
  const elong = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
  const inc = Math.atan2(sdist * Math.sin(elong), m.dist - sdist * Math.cos(elong));
  return {
    elevation: alt * DEG,
    azimuth: ((azSouth * DEG + 180) % 360 + 360) % 360,
    illumination: (1 + Math.cos(inc)) / 2,
  };
}

/** World-space unit vector (+x east, +y up, -z north) for an elevation/azimuth pair. */
export function skyDirection(p: SkyPosition): [number, number, number] {
  const el = p.elevation * RAD;
  const az = p.azimuth * RAD;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
}

/**
 * Basis of the rotating equatorial frame expressed in world space; star fields are
 * fixed in this frame so they wheel around the celestial pole through the night.
 */
export function celestialBasis(ms: number, latitude: number, longitude: number) {
  const phi = latitude * RAD;
  const pole: [number, number, number] = [0, Math.sin(phi), -Math.cos(phi)];
  const ex0: [number, number, number] = [1, 0, 0];
  const ey0: [number, number, number] = [
    pole[1] * ex0[2] - pole[2] * ex0[1],
    pole[2] * ex0[0] - pole[0] * ex0[2],
    pole[0] * ex0[1] - pole[1] * ex0[0],
  ];
  const a = -localSiderealTime(ms, longitude);
  const c = Math.cos(a);
  const s = Math.sin(a);
  const ex = ex0.map((v, i) => v * c + ey0[i] * s) as [number, number, number];
  const ey = ey0.map((v, i) => v * c - ex0[i] * s) as [number, number, number];
  return { ex, ey, pole };
}
