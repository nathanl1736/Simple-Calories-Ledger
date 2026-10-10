/**
 * Runs `run` with its own AbortSignal, and settles as soon as one of three things happens: it
 * finishes, `timeoutMs` passes, or the caller's `signal` aborts. A timeout or abort also aborts
 * the signal `run` was given, so a fetch inside it stops too, but the returned promise does not
 * wait for that: a request that ignores its signal can't keep anyone waiting past the deadline.
 */
export function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  { timeoutMs, signal, onTimeout }: { timeoutMs: number; signal?: AbortSignal; onTimeout: () => Error }
): Promise<T> {
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      settle();
    };
    function onAbort() {
      controller.abort();
      finish(() => reject(abortError()));
    }
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      finish(() => reject(onTimeout()));
    }, Math.max(0, timeoutMs));
    let started: Promise<T>;
    try {
      started = run(controller.signal);
    } catch (err) {
      finish(() => reject(err));
      return;
    }
    // After a timeout or abort, whatever `run` does next is ignored (and never left unhandled).
    started.then(value => finish(() => resolve(value)), err => finish(() => reject(err)));
  });
}

/** The error a cancelled request ends with, shaped like the browser's own. */
export function abortError(message = 'Request cancelled.') {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}
