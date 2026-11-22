import { type DroneState, type WeatherMode, type WeatherState, celestialAt, gameTime } from '@oilrig/shared';
import { NetClient } from '../net/client.ts';
import type { Game } from './game.ts';

function hhmm(hour: number) {
  const h = Math.floor(((hour % 24) + 24) % 24);
  const m = Math.floor((hour - Math.floor(hour)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** The connection to the server, and what each of its messages does to the game. */
export function createNet(g: Game): NetClient {
  const { avatars, dbg, doors } = g.stage;
  const net: NetClient = new NetClient({
    onWelcome(w) {
      g.online = true;
      g.selfId = w.you.id;
      avatars.selfId = g.selfId;
      g.ui.setSelf(w.you);
      avatars.clear();
      g.clock = w.clock;
      g.serverWeather = w.weather as WeatherState;
      g.weatherMode = w.weatherMode as WeatherMode;
      g.playerList.clear();
      for (const p of w.players) {
        g.playerList.set(p.id, p);
        avatars.add(p);
      }
      for (const [id, open] of Object.entries(w.doors)) doors.setOpen(id, open);
      if (!dbg.drone) g.seat.set(w.drone as DroneState, w.crew, false);
      g.liftState = w.elevator;
      if (!g.joined) {
        g.player.teleport(w.pose.p, w.pose.yaw);
        for (const c of w.chat) g.ui.addChat(c);
        g.ui.addChat({ system: `Welcome aboard, ${w.you.name}.` });
        g.session.enterWorld();
      } else {
        g.ui.addChat({ system: 'Reconnected.' });
      }
      g.ui.setPlayers([...g.playerList.values()], true);
    },
    onMessage(m) {
      switch (m.type) {
        case 'snapshot':
          avatars.snapshot(m.t, m.players);
          if (m.drone && g.seat.mine !== 0) g.dronePoses.push(m.t, m.drone);
          break;
        case 'join':
          g.playerList.set(m.player.id, m.player);
          avatars.add(m.player);
          g.ui.addChat({ system: `${m.player.name} came aboard.` });
          g.ui.setPlayers([...g.playerList.values()], true);
          break;
        case 'player':
          g.playerList.set(m.player.id, m.player);
          avatars.rename(m.player.id, m.player.name);
          if (m.player.id === g.selfId) g.ui.setSelf(m.player);
          g.ui.setPlayers([...g.playerList.values()], true);
          break;
        case 'leave': {
          const p = g.playerList.get(m.id);
          g.playerList.delete(m.id);
          avatars.remove(m.id);
          if (p) g.ui.addChat({ system: `${p.name} left.` });
          g.ui.setPlayers([...g.playerList.values()], true);
          break;
        }
        case 'env':
          g.serverWeather = m.weather as WeatherState;
          break;
        case 'envctl': {
          const now = net.serverNow();
          const jumped = Math.abs(gameTime(m.clock, now) - gameTime(g.clock, now)) > 120_000;
          const rateChanged = Math.abs(m.clock.rate - g.clock.rate) > 1e-6;
          const who = m.by ?? 'Someone';
          if (m.weatherMode !== g.weatherMode) g.ui.addChat({ system: `${who} changed the weather: ${m.weatherMode === 'auto' ? 'back to the forecast' : m.weatherMode}.` });
          if (jumped) g.ui.addChat({ system: `${who} set the time to ${hhmm(celestialAt(gameTime(m.clock, now)).localHour)}.` });
          if (rateChanged) g.ui.addChat({ system: `${who} changed the speed of the day.` });
          g.clock = m.clock;
          g.weatherMode = m.weatherMode as WeatherMode;
          g.envBy = m.by;
          break;
        }
        case 'chat':
          g.ui.addChat(m.entry);
          if (m.entry.from !== g.selfId) avatars.say(m.entry.from, m.entry.text);
          break;
        case 'door':
          doors.setOpen(m.id, m.open);
          break;
        case 'drone':
          if (!dbg.drone) g.seat.set(m.state as DroneState, m.crew, true);
          break;
        case 'elevator':
          g.liftState = m.state;
          break;
        case 'correct':
          g.player.teleport(m.p);
          break;
        case 'error':
          g.ui.addChat({ system: m.message });
          break;
        default:
          break;
      }
    },
    onEnded(why, message) {
      g.online = false;
      if (why === 'signed-out') g.ui.setAccount(null);
      if (!g.joined) {
        g.ui.joinFailed(message);
        return;
      }
      g.session.leave(why === 'replaced' ? 'Signed in elsewhere: this tab left the platform.' : message, true);
    },
    onClose(reason, _willRetry, unreachable) {
      g.online = false;
      g.ui.setPlayers([], false);
      if (!g.joined) {
        // Stop the background retries: the join card offers the next step instead.
        net.disconnect();
        g.ui.joinFailed(reason, unreachable);
      } else g.ui.addChat({ system: reason });
    },
  });
  return net;
}
