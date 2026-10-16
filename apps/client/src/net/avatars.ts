import {
  CapsuleGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardNodeMaterial,
  SphereGeometry,
} from 'three/webgpu';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { InterpolationBuffer, NET, type PlayerInfo, type PlayerPose, type Vec3 } from '@ocean-home/shared';

interface Avatar {
  info: PlayerInfo;
  root: Group;
  head: Mesh;
  legs: [Group, Group];
  arms: [Group, Group];
  buffer: InterpolationBuffer;
  phase: number;
  label: CSS2DObject;
  bubble: HTMLElement;
  bubbleUntil: number;
}

function limb(geo: CapsuleGeometry, mat: MeshStandardNodeMaterial, length: number) {
  const pivot = new Group();
  const m = new Mesh(geo, mat);
  m.position.y = -length / 2;
  m.castShadow = true;
  pivot.add(m);
  return pivot;
}

/** Procedural figures for the other people on board, with name tags and chat bubbles. */
export class Avatars {
  readonly group = new Group();
  private readonly avatars = new Map<string, Avatar>();
  private readonly skin = new MeshStandardNodeMaterial({ color: new Color(0xd9b49a), roughness: 0.7 });
  private readonly pants = new MeshStandardNodeMaterial({ color: new Color(0x2a2f36), roughness: 0.85 });
  private readonly torsoGeo = new CapsuleGeometry(0.2, 0.42, 6, 14);
  private readonly limbGeo = new CapsuleGeometry(0.065, 0.62, 4, 10);
  private readonly armGeo = new CapsuleGeometry(0.05, 0.52, 4, 10);
  private readonly headGeo = new SphereGeometry(0.13, 18, 14);
  selfId: string | null = null;

  add(info: PlayerInfo) {
    if (info.id === this.selfId || this.avatars.has(info.id)) return;
    const shirt = new MeshStandardNodeMaterial({ color: new Color(info.color), roughness: 0.75 });
    const root = new Group();
    const torso = new Mesh(this.torsoGeo, shirt);
    torso.position.y = 1.22;
    torso.castShadow = true;
    const head = new Mesh(this.headGeo, this.skin);
    head.position.y = 1.62;
    head.castShadow = true;
    const legL = limb(this.limbGeo, this.pants, 0.75);
    const legR = limb(this.limbGeo, this.pants, 0.75);
    legL.position.set(-0.1, 0.86, 0);
    legR.position.set(0.1, 0.86, 0);
    const armL = limb(this.armGeo, shirt, 0.6);
    const armR = limb(this.armGeo, shirt, 0.6);
    armL.position.set(-0.27, 1.47, 0);
    armR.position.set(0.27, 1.47, 0);
    root.add(torso, head, legL, legR, armL, armR);

    const tagEl = document.createElement('div');
    tagEl.className = 'tag';
    tagEl.textContent = info.name;
    if (info.kind === 'agent') {
      // AI agents look like everyone else, with a small badge on the name tag.
      tagEl.classList.add('agent');
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'AI';
      tagEl.append(badge);
    }
    // Name tag and speech bubble share one label anchored at its bottom edge, so the
    // bubble stacks above the tag at any distance instead of overlapping it.
    const labelEl = document.createElement('div');
    labelEl.className = 'label';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.hidden = true;
    labelEl.append(bubble, tagEl);
    const label = new CSS2DObject(labelEl);
    label.center.set(0.5, 1);
    label.position.set(0, 1.98, 0);
    root.add(label);

    root.visible = false;
    this.group.add(root);
    this.avatars.set(info.id, {
      info,
      root,
      head,
      legs: [legL, legR],
      arms: [armL, armR],
      buffer: new InterpolationBuffer(),
      phase: 0,
      label,
      bubble,
      bubbleUntil: 0,
    });
  }

  remove(id: string) {
    const a = this.avatars.get(id);
    if (!a) return;
    a.label.element.remove();
    this.group.remove(a.root);
    this.avatars.delete(id);
  }

  clear() {
    for (const id of [...this.avatars.keys()]) this.remove(id);
  }

  snapshot(t: number, poses: PlayerPose[]) {
    for (const p of poses) {
      const a = this.avatars.get(p.id);
      if (!a) continue;
      a.buffer.push({ t, p: p.p, yaw: p.yaw, pitch: p.pitch, speed: p.speed });
    }
  }

  say(id: string, text: string) {
    const a = this.avatars.get(id);
    if (!a) return;
    a.bubble.textContent = text;
    a.bubble.hidden = false;
    a.bubbleUntil = performance.now() + 7000;
  }

  /** `seated`: people in the drone, placed on their seat cushions (feet frame) facing its heading. */
  update(serverNow: number, dt: number, seated?: Map<string, { position: Vec3; yaw: number }>) {
    const renderT = serverNow - NET.interpolationDelayMs;
    const now = performance.now();
    for (const [id, a] of this.avatars) {
      const seat = seated?.get(id);
      if (seat) {
        // Hips on the cushion, thighs forward, arms resting.
        a.root.visible = true;
        a.root.position.set(seat.position[0], seat.position[1] - 0.84, seat.position[2]);
        a.root.rotation.y = seat.yaw;
        a.legs[0].rotation.x = a.legs[1].rotation.x = 1.25;
        a.arms[0].rotation.x = a.arms[1].rotation.x = 0.5;
        if (!a.bubble.hidden && now > a.bubbleUntil) a.bubble.hidden = true;
        continue;
      }
      const s = a.buffer.sample(renderT);
      if (!s) continue;
      a.root.visible = true;
      a.root.position.set(s.p[0], s.p[1], s.p[2]);
      a.root.rotation.y = s.yaw;
      a.head.rotation.x = s.pitch * 0.6;
      a.phase += dt * Math.min(s.speed, 7) * 2.6;
      const swing = Math.sin(a.phase) * Math.min(1, s.speed / 3) * 0.55;
      a.legs[0].rotation.x = swing;
      a.legs[1].rotation.x = -swing;
      a.arms[0].rotation.x = -swing * 0.8;
      a.arms[1].rotation.x = swing * 0.8;
      if (!a.bubble.hidden && now > a.bubbleUntil) a.bubble.hidden = true;
    }
  }

  get count() {
    return this.avatars.size;
  }
}
