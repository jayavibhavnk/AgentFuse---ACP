import type { Message } from "./types.js";

export const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;

export function createMessageStream(): {
  push: (m: Message) => void;
  iterate: () => AsyncIterable<Message>;
  close: () => void;
} {
  const pending: Message[] = [];
  let closed = false;
  let notify: (() => void) | null = null;

  function push(m: Message) {
    if (closed) return;
    pending.push(m);
    const n = notify;
    notify = null;
    n?.();
  }

  function close() {
    closed = true;
    const n = notify;
    notify = null;
    n?.();
  }

  async function* iterate(): AsyncIterable<Message> {
    while (true) {
      while (pending.length > 0) {
        yield pending.shift()!;
      }
      if (closed) return;
      await new Promise<void>((r) => {
        notify = r;
      });
    }
  }

  return { push, iterate: () => iterate(), close };
}
