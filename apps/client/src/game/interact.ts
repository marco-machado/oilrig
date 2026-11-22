import { elevatorPose } from '@oilrig/shared';
import type { Game } from './game.ts';

/** E on whatever the player looks at: a door, the drone, an elevator button. */
export function interact(g: Game, id: string) {
  const { doors } = g.stage;
  if (id.startsWith('door-')) {
    const open = !doors.isOpen(id);
    if (g.online) g.net.send({ type: 'door', id, open });
    else doors.setOpen(id, open);
    return;
  }
  if (id === 'drone') {
    g.seat.board();
    return;
  }
  if (id.startsWith('lift-')) {
    const p = elevatorPose(g.liftState, g.now());
    const stop = id === 'lift-car' ? (p.stop === 1 ? 0 : 1) : Number(id.slice('lift-call-'.length));
    if (id === 'lift-car' && p.stop === null) return;
    g.calling = { stop, until: performance.now() + 25_000 };
    if (g.online) g.net.send({ type: 'elevator', stop });
    else g.localLift.call(stop, Date.now());
  }
}

/** The hint under the crosshair for what E would do. */
export function promptFor(g: Game, focus: string | null, liftNow: ReturnType<typeof elevatorPose>): string | null {
  const { doors, layout } = g.stage;
  if (!focus) return null;
  if (focus.startsWith('door-')) return `E · ${doors.isOpen(focus) ? 'Close' : 'Open'} ${layout.doors.find((d) => d.id === focus)?.name.toLowerCase()}`;
  if (focus === 'drone') return g.crew[0] === null ? 'E · Fly the drone' : 'E · Board the drone';
  if (focus === 'lift-car') return liftNow.stop === null ? null : `E · ${liftNow.stop === 1 ? 'Down to the boat landing' : 'Up to the main deck'}`;
  if (focus.startsWith('lift-call-')) {
    const stop = Number(focus.slice('lift-call-'.length));
    return liftNow.stop === stop && liftNow.phase !== 'closing' ? 'Elevator is here' : 'E · Call the elevator';
  }
  return null;
}
