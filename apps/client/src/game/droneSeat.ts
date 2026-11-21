import { DIMS, DroneAutopilot, DroneFlight, type DronePose, type DroneState, PLAYER, type Vec3, droneClearPath, dronePose, padOccupied } from '@ocean-home/shared';
import type { Controls } from '../player/controls.ts';
import { type Game, LOCAL_ID } from './game.ts';

const PILOT_DT = 1 / 120;
const SEAT_NAMES = ['pilot', 'front passenger', 'rear left', 'rear right'];
const DRONE_NEWS: Partial<Record<DroneState['phase'], string>> = {
  approach: 'The drone is on its way back.',
  hold: 'The drone is holding off: please clear the helipad.',
  depart: 'The drone is lifting off.',
  return: 'The drone is flying itself back to the helipad.',
};

/** The drone as this browser shows it. */
export type ShownDrone = DronePose & { grounded: boolean };

/** The drone as far as this browser's player is concerned: boarding, flying, climbing out. */
export class DroneSeat {
  private readonly g: Game;
  /** The flight model, while this player is the pilot. */
  flight: DroneFlight | null = null;
  /** Flying home on its own, with the pilot looking around freely (relative to the drone). */
  autopilot: DroneAutopilot | null = null;
  private pilotAcc = 0;
  /** The seat this player sits in. */
  mine: number | null = null;
  /** The drone as the last frame drew it. */
  last: ShownDrone | null = null;

  constructor(g: Game) {
    this.g = g;
  }

  /** Takes over the drone's state and crew (from the server or the local schedule), with the news for the chat. */
  set(next: DroneState, nextCrew: Array<string | null>, announce: boolean) {
    const g = this.g;
    if (announce && next.phase !== g.droneState.phase) {
      if (next.phase === 'landed' && g.droneState.phase === 'descend') g.ui.addChat({ system: 'The drone has landed on the helipad.' });
      else if (next.phase === 'piloted') g.ui.addChat({ system: `${g.nameOf(nextCrew[0]) === 'you' ? 'You are' : `${g.nameOf(nextCrew[0])} is`} flying the drone.` });
      else if (DRONE_NEWS[next.phase]) g.ui.addChat({ system: DRONE_NEWS[next.phase]! });
    }
    if (next.phase !== 'piloted') g.dronePoses.clear();
    g.droneState = next;
    g.crew = nextCrew;
    this.sync();
  }

  /** The drone as this browser should show it right now. */
  current(now: number, renderT: number): ShownDrone {
    const g = this.g;
    const { dbg } = g.stage;
    if (this.flight) return { ...this.flight.pose, grounded: this.flight.grounded };
    if (g.droneState.phase === 'piloted') {
      const live = g.dronePoses.sample(renderT);
      if (live) return live;
    }
    const t = dbg.drone ? g.droneState.t0 + (dbg.droneT ?? 0) * 1000 + g.simTime * 1000 : now;
    return { ...dronePose(g.droneState, t), grounded: g.droneState.phase === 'landed' || g.droneState.phase === 'piloted' };
  }

  /** Sits the player down or stands them up when the crew list says their seat changed. */
  private sync() {
    const g = this.g;
    const { controls, sound, sw } = g.stage;
    const seat = g.crew.indexOf(g.selfId);
    const next = seat < 0 ? null : seat;
    if (next === this.mine) return;
    const pose = this.last;
    if (next !== null) {
      // Sit down: the pilot looks where the drone points; passengers look relative to it.
      g.player.seated = true;
      sound.setSeated(true);
      if (next === 0) {
        this.flight = new DroneFlight(sw, g.droneState.from, g.droneState.padYaw);
        this.pilotAcc = 0;
        controls.yaw = g.droneState.padYaw;
      } else {
        controls.yaw = 0;
      }
      controls.pitch = -0.08;
      g.ui.addChat({ system: next === 0 ? 'You take the pilot’s seat. Space to lift off.' : `You take the ${SEAT_NAMES[next]} seat.` });
    } else {
      // Stood up (climbed out, or the server let us go): look the way we were looking.
      if (this.mine !== null && (this.mine > 0 || this.autopilot) && pose) controls.yaw += pose.yaw;
      this.autopilot = null;
      g.player.seated = false;
      sound.setSeated(false);
      this.flight?.dispose();
      this.flight = null;
    }
    this.mine = next;
  }

  board() {
    const g = this.g;
    if (g.online) {
      g.net.send({ type: 'board' });
      return;
    }
    const seat = g.localCrew.board(LOCAL_ID);
    if (seat === 0) g.localDrone.takeControl(Date.now());
    this.set(g.localDrone.state, [...g.localCrew.seats], false);
  }

  /** A free spot beside the drone with a floor under it, for climbing out. */
  private exitSpot(pose: DronePose): Vec3 | null {
    const g = this.g;
    const { sw } = g.stage;
    const seat = DIMS.DRONE.seats[this.mine ?? 0];
    const side = seat[0] < 0 ? -1 : 1;
    const cands: Array<[number, number]> = [
      [side * 2.1, seat[2]],
      [-side * 2.1, seat[2]],
      [0, 3.4],
      [0, -3.7],
      [side * 2.1, 1.8],
      [-side * 2.1, -1.8],
    ];
    const c = Math.cos(pose.yaw);
    const s = Math.sin(pose.yaw);
    const capsule = new sw.R.Capsule((PLAYER.height - 2 * PLAYER.radius) / 2, PLAYER.radius);
    for (const [x, z] of cands) {
      const wx = pose.position[0] + x * c + z * s;
      const wz = pose.position[2] - x * s + z * c;
      const ground = g.ground([wx, pose.position[1] + 1.6, wz], 3.5);
      if (ground === null || Math.abs(ground - pose.position[1]) > 1.5) continue;
      const center = { x: wx, y: ground + PLAYER.height / 2 + 0.06, z: wz };
      const blocked = sw.world.intersectionWithShape(center, { x: 0, y: 0, z: 0, w: 1 }, capsule, undefined, undefined, undefined, undefined, (col) => {
        const i = sw.info.get(col.handle);
        return !!i && i.kind !== 'drone';
      });
      if (!blocked) return [wx, ground, wz];
    }
    return null;
  }

  climbOut(pose: ShownDrone) {
    const g = this.g;
    const { controls } = g.stage;
    if (!pose.grounded) return;
    const spot = this.exitSpot(pose);
    if (!spot) {
      g.ui.addChat({ system: 'No room to climb out here.' });
      return;
    }
    const wasPilot = this.mine === 0;
    const yawNow = this.viewYaw(pose);
    if (g.online) g.net.send({ type: 'unboard', p: spot });
    // Leave locally straight away; the server agrees or corrects.
    const seats = g.crew.map((id) => (id === g.selfId ? null : id));
    if (!g.online) {
      g.localCrew.leave(LOCAL_ID);
      if (wasPilot) g.localDrone.release(Date.now(), pose.position, pose.yaw, true);
    }
    const next = g.online ? { ...g.droneState, ...(wasPilot ? { phase: 'landed' as const, from: pose.position, padYaw: pose.yaw, fromYaw: pose.yaw } : {}) } : g.localDrone.state;
    this.set(next, seats, false);
    controls.yaw = yawNow;
    g.player.teleport(spot);
  }

  /** Where the seated player looks: the pilot steers with the view, everyone else looks around the cabin. */
  viewYaw(pose: DronePose) {
    const { controls } = this.g.stage;
    return this.mine === 0 && !this.autopilot ? controls.yaw : pose.yaw + controls.yaw;
  }

  /** H in the pilot's seat: fly home and land on the helipad, or hand the controls back. */
  private toggleAutopilot() {
    const g = this.g;
    const { controls, sw } = g.stage;
    if (!this.flight) return;
    if (this.autopilot) {
      this.stopAutopilot('Autopilot off: you have the controls.');
      return;
    }
    const p = this.flight.pose;
    if (this.flight.grounded && Math.hypot(p.position[0] - DIMS.DRONE.pad[0], p.position[2] - DIMS.DRONE.pad[2]) < 2.5) {
      g.ui.addChat({ system: 'You are already on the helipad.' });
      return;
    }
    this.autopilot = new DroneAutopilot(p.position, (a, b) => droneClearPath(sw, a, b));
    // The view stops steering: keep looking the same way, now relative to the drone.
    controls.yaw -= this.flight.yaw;
    g.ui.addChat({ system: 'Autopilot on: flying home to the helipad.' });
  }

  private stopAutopilot(message: string | null) {
    if (!this.autopilot || !this.flight) return;
    this.autopilot = null;
    this.g.stage.controls.yaw += this.flight.yaw;
    if (message) this.g.ui.addChat({ system: message });
  }

  /** One frame in the pilot's seat: the stick or the autopilot flies the drone, in fixed steps. */
  pilot(dt: number, input: ReturnType<Controls['sampleFlight']>) {
    const g = this.g;
    const flight = this.flight;
    if (!flight) return;
    if (input.home) this.toggleAutopilot();
    else if (this.autopilot && Math.abs(input.forward) + Math.abs(input.right) + Math.abs(input.up) > 0.05) this.stopAutopilot('You have the controls.');
    // It waits above the pad while anyone (not aboard) stands on the landing circle.
    const padBusy = this.autopilot ? padOccupied(g.stage.avatars.standing((id) => g.crew.includes(id))) : false;
    this.pilotAcc += dt;
    let steps = 0;
    while (this.pilotAcc >= PILOT_DT && steps < 12) {
      flight.step(this.autopilot ? this.autopilot.step(flight, PILOT_DT, padBusy) : input, PILOT_DT);
      this.pilotAcc -= PILOT_DT;
      steps++;
    }
    if (this.autopilot?.stage === 'landed') this.stopAutopilot('Landed on the helipad. E to climb out.');
    else if (this.autopilot?.stage === 'stuck') this.stopAutopilot('The autopilot cannot find a way home from here: you have the controls.');
    if (!g.online) g.localDrone.track(flight.pose.position, flight.yaw);
  }
}
