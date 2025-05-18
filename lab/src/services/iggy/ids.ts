// Sanitizes resource names into Iggy-safe identifiers.
export const sanitizeId = (name?: string): string => {
  if (!name || typeof name !== "string") return "";
  return name.replace(/[:/]/g, "_").toLowerCase().trim();
};
