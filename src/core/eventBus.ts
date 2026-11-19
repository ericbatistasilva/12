export class EventBus<Events extends Record<string, unknown>> {
  private listeners: Map<keyof Events, Set<(payload: never) => void>> = new Map();

  on<K extends keyof Events>(eventName: K, handler: (payload: Events[K]) => void): () => void {
    let set = this.listeners.get(eventName);
    if (!set) {
      set = new Set();
      this.listeners.set(eventName, set);
    }
    set.add(handler as (payload: never) => void);
    return () => {
      set?.delete(handler as (payload: never) => void);
    };
  }

  emit<K extends keyof Events>(eventName: K, payload: Events[K]): void {
    const set = this.listeners.get(eventName);
    if (!set) return;
    for (const handler of set) {
      handler(payload as never);
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
