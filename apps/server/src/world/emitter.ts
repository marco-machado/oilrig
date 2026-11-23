/** A small typed event emitter. */
export class Emitter<Events extends Record<keyof Events, unknown[]>> {
  private readonly listeners = new Map<keyof Events, Set<(...args: never[]) => void>>();

  on<K extends keyof Events>(event: K, fn: (...args: Events[K]) => void) {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(fn as unknown as (...args: never[]) => void);
    return this;
  }

  off<K extends keyof Events>(event: K, fn: (...args: Events[K]) => void) {
    this.listeners.get(event)?.delete(fn as unknown as (...args: never[]) => void);
    return this;
  }

  emit<K extends keyof Events>(event: K, ...args: Events[K]) {
    const set = this.listeners.get(event);
    if (!set) return false;
    for (const fn of [...set]) (fn as unknown as (...a: Events[K]) => void)(...args);
    return true;
  }
}
