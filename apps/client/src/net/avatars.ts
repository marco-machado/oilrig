import {
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardNodeMaterial,
  SphereGeometry,
} from 'three/webgpu';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { InterpolationBuffer, NET, type PlayerInfo, type PlayerPose, type Vec3 } from '@oilrig/shared';

interface Avatar {
  info: PlayerInfo;
  root: Group;
  head: Mesh;
  legs: [Group, Group];
  knees: [Group, Group];
  arms: [Group, Group];
  elbows: [Group, Group];
  buffer: InterpolationBuffer;
  phase: number;
  label: CSS2DObject;
  tag: HTMLElement;
  bubble: HTMLElement;
  bubbleUntil: number;
}

/**
 * A limb hung from its joint: the capsule's top cap is centred on the pivot and the next joint
 * sits at the bottom cap's centre, `length` below, so a bent joint stays closed.
 */
function limb(geo: CapsuleGeometry, mat: MeshStandardNodeMaterial, child?: Group) {
  const length = geo.parameters.height;
  const pivot = new Group();
  const m = new Mesh(geo, mat);
  m.position.y = -length / 2;
  m.castShadow = true;
  pivot.add(m);
  if (child) {
    child.position.y = -length;
    pivot.add(child);
  }
  return pivot;
}

// Proportions of a 1.80 m person (the player collider): hips 0.93, shoulders 1.47, eyes 1.65.
const HIP_Y = 0.93;
const HIP_X = 0.09;
const SHOULDER_Y = 1.42;

/** A speech bubble that has had its time plays its exit animation, then hides. */
function expireBubble(a: Avatar, now: number) {
  if (a.bubble.hidden || now <= a.bubbleUntil) return;
  if (now > a.bubbleUntil + 260) {
    a.bubble.hidden = true;
    a.bubble.classList.remove('is-leaving');
  } else if (!a.bubble.classList.contains('is-leaving')) {
    a.bubble.classList.add('is-leaving');
  }
}

/** Procedural figures for the other people on board, with name tags and chat bubbles. */
export class Avatars {
  readonly group = new Group();
  private readonly avatars = new Map<string, Avatar>();
  private readonly skin = new MeshStandardNodeMaterial({ color: new Color(0xd9b49a), roughness: 0.7 });
  private readonly pants = new MeshStandardNodeMaterial({ color: new Color(0x2a2f36), roughness: 0.85 });
  // Torso 0.30 wide and 0.25 deep, from the hips (0.84) to the shoulders (1.47).
  private readonly torsoGeo = new CapsuleGeometry(0.125, 0.38, 6, 14).scale(1.2, 1, 1);
  private readonly neckGeo = new CylinderGeometry(0.05, 0.055, 0.14, 12);
  // Hip to knee 0.44, knee to sole 0.49: standing, the soles are at y = 0.
  private readonly thighGeo = new CapsuleGeometry(0.07, 0.44, 4, 10);
  private readonly shinGeo = new CapsuleGeometry(0.055, 0.435, 4, 10);
  // Shoulder to elbow 0.31, elbow to fingertips 0.41: hanging, the hands end at 0.70.
  private readonly upperArmGeo = new CapsuleGeometry(0.05, 0.31, 4, 10);
  private readonly forearmGeo = new CapsuleGeometry(0.042, 0.368, 4, 10);
  // 0.24 tall from the chin (1.54) to the crown (1.78).
  private readonly headGeo = new SphereGeometry(0.12, 18, 14).scale(0.82, 1, 0.92);
  selfId: string | null = null;

  add(info: PlayerInfo) {
    if (info.id === this.selfId || this.avatars.has(info.id)) return;
    const shirt = new MeshStandardNodeMaterial({ color: new Color(info.color), roughness: 0.75 });
    const root = new Group();
    const torso = new Mesh(this.torsoGeo, shirt);
    torso.position.y = 1.155;
    torso.castShadow = true;
    const neck = new Mesh(this.neckGeo, this.skin);
    neck.position.y = 1.515;
    neck.castShadow = true;
    const head = new Mesh(this.headGeo, this.skin);
    head.position.y = 1.66;
    head.castShadow = true;
    const knees: [Group, Group] = [limb(this.shinGeo, this.pants), limb(this.shinGeo, this.pants)];
    const legL = limb(this.thighGeo, this.pants, knees[0]);
    const legR = limb(this.thighGeo, this.pants, knees[1]);
    legL.position.set(-HIP_X, HIP_Y, 0);
    legR.position.set(HIP_X, HIP_Y, 0);
    const elbows: [Group, Group] = [limb(this.forearmGeo, shirt), limb(this.forearmGeo, shirt)];
    const armL = limb(this.upperArmGeo, shirt, elbows[0]);
    const armR = limb(this.upperArmGeo, shirt, elbows[1]);
    // Shoulders 0.49 across the arms, inside the 0.60 collider.
    armL.position.set(-0.195, SHOULDER_Y, 0);
    armR.position.set(0.195, SHOULDER_Y, 0);
    root.add(torso, neck, head, legL, legR, armL, armR);

    const tagEl = document.createElement('div');
    tagEl.className = 'tag';
    tagEl.append(info.name);
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
      knees,
      arms: [armL, armR],
      elbows,
      buffer: new InterpolationBuffer(),
      phase: 0,
      label,
      tag: tagEl,
      bubble,
      bubbleUntil: 0,
    });
  }

  /** Someone's display name changed. */
  rename(id: string, name: string) {
    const a = this.avatars.get(id);
    if (!a) return;
    a.info = { ...a.info, name };
    a.tag.firstChild!.textContent = name;
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
    // Pop in again for each new message, even over one still showing.
    a.bubble.classList.remove('is-leaving');
    a.bubble.hidden = true;
    void a.bubble.offsetWidth;
    a.bubble.hidden = false;
    a.bubbleUntil = performance.now() + 7000;
  }

  /** `seated`: people in the drone, their feet (root) placed in its cabin, following its attitude. */
  update(serverNow: number, dt: number, seated?: Map<string, { position: Vec3; yaw: number; pitch?: number; roll?: number }>) {
    const renderT = serverNow - NET.interpolationDelayMs;
    const now = performance.now();
    for (const [id, a] of this.avatars) {
      const seat = seated?.get(id);
      if (seat) {
        // Sitting: thighs level, shins down to the cabin floor (0.44 below the cushion), hands
        // on the lap. The root is the feet frame; the caller puts it DRONE.seatedHips below the
        // cushion in the body frame, so the hips rest on the seat whatever the cabin's bank.
        a.root.visible = true;
        a.root.position.set(seat.position[0], seat.position[1], seat.position[2]);
        a.root.rotation.set(seat.pitch ?? 0, seat.yaw, seat.roll ?? 0, 'YXZ');
        a.legs[0].position.x = -HIP_X;
        a.legs[1].position.x = HIP_X;
        a.legs[0].rotation.x = a.legs[1].rotation.x = 1.5;
        a.knees[0].rotation.x = a.knees[1].rotation.x = -1.45;
        a.arms[0].rotation.x = a.arms[1].rotation.x = 0.35;
        a.elbows[0].rotation.x = a.elbows[1].rotation.x = 1.1;
        expireBubble(a, now);
        continue;
      }
      const s = a.buffer.sample(renderT);
      if (!s) continue;
      a.root.visible = true;
      a.root.position.set(s.p[0], s.p[1], s.p[2]);
      a.root.rotation.set(0, s.yaw, 0, 'YXZ');
      a.head.rotation.x = s.pitch * 0.6;
      a.phase += dt * Math.min(s.speed, 7) * 2.6;
      const swing = Math.sin(a.phase) * Math.min(1, s.speed / 3) * 0.55;
      a.legs[0].position.x = -HIP_X;
      a.legs[1].position.x = HIP_X;
      a.legs[0].rotation.x = swing;
      a.legs[1].rotation.x = -swing;
      a.knees[0].rotation.x = a.knees[1].rotation.x = 0;
      a.arms[0].rotation.x = -swing * 0.8;
      a.arms[1].rotation.x = swing * 0.8;
      a.elbows[0].rotation.x = a.elbows[1].rotation.x = 0.1;
      expireBubble(a, now);
    }
  }

  get count() {
    return this.avatars.size;
  }

  /** Where the others stand (feet), leaving out anyone `skip` names (people seated in the drone). */
  standing(skip: (id: string) => boolean): Vec3[] {
    const out: Vec3[] = [];
    for (const [id, a] of this.avatars) {
      if (!a.root.visible || skip(id)) continue;
      out.push([a.root.position.x, a.root.position.y, a.root.position.z]);
    }
    return out;
  }
}
