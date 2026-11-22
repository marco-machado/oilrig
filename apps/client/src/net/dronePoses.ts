import type { DronePose, DronePoseMsg, Vec3 } from '@oilrig/shared';
import { altitudeOf, lerpAngle } from '@oilrig/shared';

interface Sample {
  t: number;
  pose: DronePoseMsg;
}

/** Interpolates the drone poses a pilot streams through the server, like other people's avatars. */
export class DronePoses {
  private readonly samples: Sample[] = [];

  push(t: number, pose: DronePoseMsg) {
    const last = this.samples[this.samples.length - 1];
    if (last && t <= last.t) return;
    this.samples.push({ t, pose });
    if (this.samples.length > 40) this.samples.shift();
  }

  clear() {
    this.samples.length = 0;
  }

  get latest(): DronePoseMsg | null {
    return this.samples[this.samples.length - 1]?.pose ?? null;
  }

  sample(t: number): (DronePose & { grounded: boolean }) | null {
    const s = this.samples;
    if (s.length === 0) return null;
    let a = s[0];
    let b = s[0];
    if (t >= s[s.length - 1].t) a = b = s[s.length - 1];
    else if (t > s[0].t) {
      for (let i = 1; i < s.length; i++) {
        if (s[i].t >= t) {
          a = s[i - 1];
          b = s[i];
          break;
        }
      }
    }
    const u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
    const lerp = (x: number, y: number) => x + (y - x) * u;
    const p: Vec3 = [lerp(a.pose.p[0], b.pose.p[0]), lerp(a.pose.p[1], b.pose.p[1]), lerp(a.pose.p[2], b.pose.p[2])];
    return {
      visible: true,
      position: p,
      velocity: [...b.pose.v] as Vec3,
      yaw: lerpAngle(a.pose.yaw, b.pose.yaw, u),
      pitch: lerp(a.pose.pitch, b.pose.pitch),
      roll: lerp(a.pose.roll, b.pose.roll),
      rotor: lerp(a.pose.rotor, b.pose.rotor),
      altitude: altitudeOf(p),
      grounded: b.pose.grounded,
    };
  }
}
