import { WORLD, adjustClock, celestialAt, gameTime } from '@oilrig/shared';
import { AuthError, auth } from '../net/auth.ts';
import { probeServer } from '../net/client.ts';
import { setGpuTimingWanted } from '../perf.ts';
import { saveQualityName } from '../render/quality.ts';
import type { UIHandlers } from '../ui/ui.ts';
import { type Game, LOCAL_ID } from './game.ts';

/** Coming aboard and leaving, the start screen's view of the server, and what the UI asks for. */
export class Session {
  private readonly g: Game;
  /** Keeps the sign-in card's server state current until we are aboard. */
  private checkingServer = false;
  /** Whether this browser's account (signed in or not) is known since the server was last up. */
  private accountChecked = false;

  constructor(g: Game) {
    this.g = g;
  }

  private async checkAccount() {
    this.accountChecked = true;
    try {
      const me = await auth.me();
      this.g.ui.setAccount(me.user, me.signups);
    } catch {
      this.accountChecked = false;
    }
  }

  startServerCheck() {
    const g = this.g;
    if (g.stage.dbg.offline) {
      g.ui.setServer('local');
      return;
    }
    if (this.checkingServer) return;
    this.checkingServer = true;
    const check = async () => {
      if (g.joined) {
        this.checkingServer = false;
        return;
      }
      const h = await probeServer();
      if (!g.joined) g.ui.setServer(h);
      if (!h.online) this.accountChecked = false;
      else if (!this.accountChecked) await this.checkAccount();
      window.setTimeout(check, h.online ? 10_000 : 4000);
    };
    void check();
  }

  /** Leaves the world: fade out, drop the connection, back to the start screen. */
  leave(message?: string, error = false) {
    const g = this.g;
    const { avatars, controls, dbg, layout } = g.stage;
    g.ui.setFade(true);
    window.setTimeout(() => {
      g.net.disconnect();
      // Out of the drone: offline we hand it back to the local schedule; online the server
      // frees the seat when the socket closes.
      const last = g.seat.last;
      if (!g.online && g.seat.mine !== null) {
        g.localCrew.leave(LOCAL_ID);
        if (g.seat.mine === 0 && last) g.localDrone.release(Date.now(), last.position, last.yaw, last.grounded);
      }
      g.online = false;
      g.joined = false;
      controls.enabled = false;
      controls.unlock();
      g.selfId = LOCAL_ID;
      avatars.selfId = LOCAL_ID;
      avatars.clear();
      g.playerList.clear();
      if (!dbg.drone) g.seat.set(g.localDrone.state, [...g.localCrew.seats], false);
      g.serverWeather = null;
      g.weatherMode = g.localWeather.mode;
      g.envBy = undefined;
      g.calling = null;
      if (g.respawnTimer > 0) {
        g.respawnTimer = 0;
        g.player.teleport(layout.respawn.position, layout.respawn.yaw);
        g.player.frozen = false;
      }
      g.ui.setPlayers([], false);
      g.ui.left(message, error);
      this.startServerCheck();
      window.setTimeout(() => g.ui.setFade(false), 150);
    }, 450);
  }

  enterWorld() {
    const g = this.g;
    const { controls } = g.stage;
    g.joined = true;
    g.ui.joined = true;
    controls.enabled = true;
    g.ui.hideOverlay();
    controls.lock();
    // If the browser refuses the pointer lock, the cursor stays free: show the toolbar.
    setTimeout(() => g.ui.setCursorFree(!controls.locked && !g.ui.chatOpen), 400);
  }

  /** What the start screen, the chat and the panels ask of the game. */
  uiHandlers(): UIHandlers {
    const g = this.g;
    const { camera, controls, dbg, dynRes, fixedRes, sound } = g.stage;
    return {
      onSignIn: async (username, password) => {
        try {
          const { user } = await auth.signIn(username, password);
          g.ui.setAccount(user);
        } catch (err) {
          g.ui.signInFailed(err instanceof AuthError ? err.message : 'Could not sign in.');
          return;
        }
        // Signed in: straight aboard.
        sound.start();
        g.net.connect();
      },
      onJoin: () => {
        sound.start();
        if (dbg.offline) {
          this.enterWorld();
          return;
        }
        g.net.connect();
      },
      onSignOut: async () => {
        try {
          await auth.signOut();
        } catch {
          // the cookie is cleared on the next successful request anyway
        }
        g.ui.setAccount(null);
        g.ui.setStatus('Signed out.');
      },
      onAccountChanged: () => {
        // The world tells everyone (this browser included) about the new name.
      },
      onExploreOffline: () => {
        sound.start();
        g.net.disconnect();
        this.enterWorld();
        g.ui.addChat({ system: 'The server is offline: you are exploring on your own.' });
      },
      onResume: () => {
        controls.lock();
      },
      onChat: (text) => {
        if (g.online) g.net.send({ type: 'chat', text });
        else g.ui.addChat({ id: 'local', from: 'local', name: 'You', text, t: Date.now() });
      },
      onSettings: (s, qualityChanged) => {
        g.baseFov = s.fov;
        camera.fov = s.fov;
        camera.updateProjectionMatrix();
        controls.settings.sensitivity = s.sensitivity;
        controls.settings.invertY = s.invertY;
        sound.setVolume(s.volume);
        dynRes.setEnabled(s.autoResolution && !fixedRes);
        if (qualityChanged) {
          saveQualityName(s.quality);
          location.reload();
        }
      },
      onEnv: (change) => {
        // A time set by hand replaces a time fixed in the URL.
        if (change.hour !== undefined || change.rate !== undefined) dbg.hour = undefined;
        if (g.online) {
          g.net.send({ type: 'setenv', ...change });
          return;
        }
        const now = Date.now();
        if (change.hour !== undefined || change.rate !== undefined) g.clock = adjustClock(g.clock, now, change);
        if (change.weather) {
          g.localWeather.set(change.weather, gameTime(g.clock, now), now);
          g.weatherMode = change.weather;
        }
      },
      onGpuTiming: (on) => {
        setGpuTimingWanted(on);
        location.reload();
      },
      onLeave: () => {
        this.leave();
      },
      sunElevationAt: (hour) => {
        const gms = gameTime(g.clock, g.now());
        const day = Math.floor(gms / 86_400_000) * 86_400_000;
        return celestialAt(day + ((hour - WORLD.longitude / 15 + 24) % 24) * 3_600_000).sunElevation;
      },
    };
  }
}
