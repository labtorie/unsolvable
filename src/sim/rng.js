// Детерминированный генератор. Состояние лежит в world.rngState (число),
// чтобы мир целиком сериализовался и снимки/ветки воспроизводились.

/** Равномерное число в [0, 1). */
export function rand(world) {
  let t = (world.rngState = (world.rngState + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randRange(world, a, b) {
  return a + (b - a) * rand(world);
}

export function randInt(world, n) {
  return Math.floor(rand(world) * n);
}

export function pick(world, arr) {
  return arr[randInt(world, arr.length)];
}

/** Нормальное распределение (Бокс — Мюллер). */
export function randNormal(world, mean = 0, sd = 1) {
  const u = 1 - rand(world);
  const v = rand(world);
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
