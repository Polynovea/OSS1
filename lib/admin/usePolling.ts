"use client";

import { useEffect, useRef } from "react";

/**
 * Refreshes visible pages without letting slow or failed requests pile up.
 *
 * The earlier `setInterval` version started a new request every 30 seconds
 * even if the last one was still pending. In development, Strict Mode also
 * makes that failure mode much easier to notice. This schedules the next run
 * only after the current one settles and backs off after failures.
 *
 * The ref trick ensures we always call the latest version of the
 * function even if it closes over state — no stale-closure bugs.
 */
export function usePolling(fetcher: () => Promise<void> | void, intervalMs = 120_000) {
  const ref = useRef(fetcher);
  ref.current = fetcher;

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;

    const schedule = (delay: number) => {
      if (!disposed) timer = setTimeout(() => void run(), delay);
    };

    const run = async () => {
      if (disposed) return;
      if (document.visibilityState !== "visible") {
        schedule(intervalMs);
        return;
      }

      try {
        await ref.current();
        failures = 0;
      } catch {
        failures += 1;
      }

      // 2m, 4m, then at most 5m. A failing integration must not consume the
      // browser, dev server, or database continuously.
      schedule(Math.min(intervalMs * 2 ** failures, 300_000));
    };

    schedule(intervalMs);
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [intervalMs]);
}
