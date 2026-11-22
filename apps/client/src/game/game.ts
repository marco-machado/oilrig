import {
  type ClockConfig,
  DEFAULT_EPOCH,
  DroneCrew,
  DroneScheduler,
  type DroneState,
  ElevatorController,
  type ElevatorState,
  type Vec3,
  WORLD,
  WeatherControl,
  type WeatherMode,
  WeatherModel,
  type WeatherState,
  droneClearPath,
  elevatorPose,
  gameTime,
  inDoorway,
  makeClock,
  padOccupied,
} from '@oilrig/shared';
import type { NetClient } from '../net/client.ts';
import { DronePoses } from '../net/dronePoses.ts';
import type { Player } from '../player/player.ts';
import type { UI } from '../ui/ui.ts';
import type { DroneSeat } from './droneSeat.ts';
import type { Session } from './session.ts';
import type { Stage } from './stage.ts';

const DEFAULT_SEED = 1337;
/** This browser's id while it is not connected. */
export const LOCAL_ID = 'local';

/**
 * The state of one running game, shared by the parts that drive it (the session, the network
 * messages, the drone seat and the frame loop): what the server last said when online, and the
 * local stand-ins for the server (clock, weather, drone schedule, elevator) when offline.
 */
export class Game {
  readonly stage: Stage;
  // Wired up by boot(), in this order, before anything can call into them.
  seat!: DroneSeat;
  session!: Session;
  ui!: UI;
  player!: Player;
  net!: NetClient;

  // ---------- shared world state (server-driven when online) ----------
  clock: ClockConfig = makeClock({ realTime: false, dayLengthMinutes: 120 });
  readonly localWeather = new WeatherControl(new WeatherModel(DEFAULT_SEED, DEFAULT_EPOCH));
  weatherMode: WeatherMode = 'auto';
  envBy: string | undefined = undefined;
  serverWeather: WeatherState | null = null;
  shownWeather: WeatherState | null = null;
  online = false;
  joined = false;
  selfId = LOCAL_ID;
  lastPose = 0;
  poseSeq = 0;
  respawnTimer = 0;
  readonly playerList = new Map<string, { id: string; name: string; color: string; kind?: 'human' | 'agent' }>();

  // The drone: the server's schedule and crew when online, local ones offline (or a fixed
  // phase from the URL for captures).
  readonly localCrew = new DroneCrew();
  readonly localDrone: DroneScheduler;
  droneState: DroneState;
  crew: Array<string | null>;
  readonly dronePoses = new DronePoses();

  // The elevator.
  readonly localLift: ElevatorController;
  liftState: ElevatorState;
  carY: number;
  liftPhase: ReturnType<typeof elevatorPose>['phase'];
  calling: { stop: number; until: number } | null = null;

  /** The field of view from the settings, and the extra at speed in the drone (eased). */
  baseFov: number;
  fovKick = 0;
  /** Seconds of frames shown so far (each frame counts for at most 0.1 s). */
  simTime = 0;
  /** P: save the next frame as a picture. */
  shotWanted = false;

  constructor(stage: Stage) {
    this.stage = stage;
    const { sw, dbg } = stage;
    this.baseFov = stage.settings.fov;
    this.localDrone = new DroneScheduler({ intervalMs: 3 * 60_000, stayMs: 10 * 60_000, firstArrivalMs: 20_000, seed: 3, startLanded: true }, Date.now(), {
      padOccupied: () => !this.player.seated && padOccupied([this.player.position]),
      aboard: () => this.localCrew.count > 0,
      clearPath: (a, b) => droneClearPath(sw, a, b),
    });
    this.droneState = dbg.drone ? dbg.drone(Date.now()) : this.localDrone.state;
    this.crew = [...this.localCrew.seats];
    this.localLift = new ElevatorController(Date.now(), { doorwayOccupied: (stop) => inDoorway(stop, this.player.position) });
    this.liftState = this.localLift.state;
    this.carY = elevatorPose(this.liftState, Date.now()).y;
    this.liftPhase = elevatorPose(this.liftState, Date.now()).phase;
  }

  /** The time everyone shares: the server's when online. */
  now() {
    return this.online ? this.net.serverNow() : Date.now();
  }

  nameOf(id: string | null) {
    return id === null ? null : id === this.selfId ? 'you' : (this.playerList.get(id)?.name ?? 'someone');
  }

  /** The height of whatever is under `p` (the drone itself excepted), or null within `max` metres. */
  ground(p: Vec3, max = 200): number | null {
    const { sw } = this.stage;
    const ray = new sw.R.Ray({ x: p[0], y: p[1] + 0.3, z: p[2] }, { x: 0, y: -1, z: 0 });
    const hit = sw.world.castRay(ray, max, true, undefined, undefined, undefined, undefined, (c) => {
      const i = sw.info.get(c.handle);
      return !!i && i.kind !== 'drone';
    });
    return hit ? p[1] + 0.3 - hit.timeOfImpact : null;
  }

  /** Game time (ms): the shared clock's, or a time of day fixed in the URL. */
  gameNow(realNow: number, simTime: number): number {
    const { dbg } = this.stage;
    const gms = gameTime(this.clock, realNow);
    if (dbg.hour === undefined) return gms;
    const day = dbg.date ?? Math.floor(gms / 86400000) * 86400000;
    return day + ((dbg.hour - WORLD.longitude / 15 + 24) % 24) * 3600000 + simTime * 1000 * dbg.timeScale;
  }
}
