import WebSocket from 'ws';
const ws = new WebSocket('ws://localhost:8787/ws');
let seq = 0;
ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', version: 2, name: 'Bot Ana' })));
ws.on('message', (d) => {
  const m = JSON.parse(d.toString());
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
    setTimeout(() => { clearInterval(timer); ws.close(); }, 25000);
  } else if (m.type === 'correct' || m.type === 'error') console.log(m);
});
