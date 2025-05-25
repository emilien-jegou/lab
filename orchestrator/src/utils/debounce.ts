export function debounce<T extends (...args: any[]) => void>(
  callback: T,
  delay: number,
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout>;

  return function (...args: Parameters<T>) {
    // Clear the previous timeout
    clearTimeout(timeout);

    // Set a new timeout to call the callback after the specified delay
    timeout = setTimeout(() => {
      callback(...args);
    }, delay);
  };
}

export function rateLimit<T extends (...args: any[]) => void>(
  callback: T,
  limit: number,
  interval: number = 100,
): (...args: Parameters<T>) => void {
  let callCount = 0;
  let lastReset = Date.now();

  return function (...args: Parameters<T>) {
    const now = Date.now();

    if (now - lastReset >= interval) {
      callCount = 0;
      lastReset = now;
    }

    if (callCount < limit) {
      callCount++;
      callback(...args);
    }
    // Else: skip silently
  };
}
