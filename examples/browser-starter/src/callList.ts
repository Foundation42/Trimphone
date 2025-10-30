export interface CallState {
  id: string;
  to?: string;
  from?: string;
  status: "active" | "dialling" | "incoming" | "ended" | "failed";
  reason?: string;
}

export class CallRegistry {
  private readonly calls = new Map<string, CallState>();
  private listeners = new Set<(calls: CallState[]) => void>();

  upsert(state: CallState): void {
    this.calls.set(state.id, state);
    this.notify();
  }

  update(id: string, updates: Partial<CallState>): void {
    const current = this.calls.get(id);
    if (!current) {
      return;
    }
    this.calls.set(id, { ...current, ...updates });
    this.notify();
  }

  remove(id: string): void {
    this.calls.delete(id);
    this.notify();
  }

  subscribe(listener: (calls: CallState[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): CallState[] {
    return Array.from(this.calls.values());
  }

  private notify() {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
