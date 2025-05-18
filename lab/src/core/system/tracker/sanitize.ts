// Sanitizes internal error messages before persisting or broadcasting them.
export const sanitizeErrorMessage = (error: unknown): string => {
  if (!error) return 'Execution failed';
  const rawMsg =
    typeof error === 'object' && error !== null && 'message' in error && typeof (error as any).message === 'string'
      ? (error as any).message
      : error instanceof Error
        ? error.message
        : String(error);

  const firstLine = (rawMsg.split('\n')[0] ?? 'Execution failed').trim();
  return firstLine.replace(/at\s+.*$/g, '').trim() || 'Execution failed';
};
