let current: HTMLMediaElement | null = null;

/** One playing item at a time: starting one pauses the last. */
export function startPlayback(el: HTMLMediaElement) {
  if (current && current !== el) current.pause();
  current = el;
  void el.play().catch(() => {
    // A failed start raises the element's error event, which shows the placeholder.
  });
}
