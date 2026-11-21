// A test player: signs in, walks around the terrace for 25 s and says hello.
// BOT_USERNAME=… BOT_PASSWORD=… [BOT_URL=http://localhost:5173] pnpm bot
import { PROTOCOL_VERSION } from '../packages/shared/src/protocol/messages.ts';

const base = process.env.BOT_URL ?? 'http://localhost:5173';
const username = process.env.BOT_USERNAME;
const password = process.env.BOT_PASSWORD;
if (!username || !password) {
  console.error('Set BOT_USERNAME and BOT_PASSWORD to an existing account.');
  process.exit(1);
}

const res = await fetch(`${base}/auth/signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
if (!res.ok) {
  console.error('sign-in failed:', res.status, await res.text());
  process.exit(1);
}
const cookie = /oilrig_session=[^;]+/.exec(res.headers.get('set-cookie') ?? '')![0];

const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/ws`, { headers: { cookie } } as unknown as string[]);
let seq = 0;
ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'hello', version: PROTOCOL_VERSION })));
ws.addEventListener('close', (e) => console.log('closed', e.code, e.reason));
ws.addEventListener('message', (e) => {
  const m = JSON.parse(String(e.data));
  if (m.type === 'welcome') {
    console.log('welcome', m.you, 'players', m.players.length);
    let t = 0;
    const timer = setInterval(() => {
      t += 0.05;
      const z = Math.max(3.5, 7 - t * 1.2);
      const x = -6 + (z <= 3.5 ? Math.sin((t - 3) * 0.6) * 2.5 : 0);
      ws.send(JSON.stringify({ type: 'pose', seq: seq++, p: [x, 20.06, z], v: [1.2, 0, -1.2], yaw: Math.PI, pitch: 0, grounded: true }));
    }, 50);
    setTimeout(() => ws.send(JSON.stringify({ type: 'chat', text: 'Hello from the terrace!' })), 1500);
    setTimeout(() => {
      clearInterval(timer);
      ws.close();
    }, 25000);
  } else if (m.type === 'correct' || m.type === 'error') console.log(m);
});
