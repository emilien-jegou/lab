export type IdGenerator = () => string;

export const createSeededGenerator = (seed: number) => {
  // Xoshiro128, high quality PRNG with good distribution
  const s = [seed, seed ^ 0x9e3779b9, seed ^ 0x85ebca6b, seed ^ 0xc2b2ae35];

  for (let i = 0; i < 10; i++) next();

  function next() {
    const result = (((s[1] * 5) << 7) | ((s[1] * 5) >>> 25)) * 9;
    const t = s[1] << 9;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = (s[3] << 11) | (s[3] >>> 21);
    return result >>> 0; // Convert to unsigned 32-bit
  }

  return (len = 4) => {
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < len; i++) {
      const randomValue = next();
      result += charset[randomValue % charset.length];
    }
    return result;
  };
};

export function djb2Hash(str: string) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) + hash + str.charCodeAt(i);
  }
  return Math.abs(hash);
}

export const generateId = (len = 12) => {
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes)
    .map((b) => charset[b % charset.length])
    .join('');
};
