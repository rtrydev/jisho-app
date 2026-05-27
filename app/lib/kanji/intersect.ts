// Uint32 bitset helpers — radical-set intersection lives in the hot path of
// the radical picker's "dim incompatible radicals" affordance, which runs
// once per click over every radical (~250 intersections, ~6,000 bits each).
// All ops are deliberately allocation-light.

export function wordsForBits(bits: number): number {
  return (bits + 31) >>> 5;
}

/** Build a Uint32Array bitset with the given 1-bit positions. */
export function buildBitset(positions: number[], totalBits: number): Uint32Array {
  const out = new Uint32Array(wordsForBits(totalBits));
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    out[p >>> 5] |= 1 << (p & 31);
  }
  return out;
}

/** Allocate a new bitset = AND of every input. Inputs must be the same length. */
export function intersectAll(sets: ReadonlyArray<Uint32Array>): Uint32Array {
  if (sets.length === 0) return new Uint32Array(0);
  const len = sets[0].length;
  const out = new Uint32Array(len);
  out.set(sets[0]);
  for (let s = 1; s < sets.length; s++) {
    const other = sets[s];
    for (let i = 0; i < len; i++) out[i] &= other[i];
  }
  return out;
}

/** In-place AND: `dst &= src`. Both arrays must be the same length. */
export function andInto(dst: Uint32Array, src: Uint32Array): void {
  const len = dst.length;
  for (let i = 0; i < len; i++) dst[i] &= src[i];
}

/** Does this bitset intersect another? Short-circuits as soon as a shared
 *  word has a non-zero AND. Used per-radical for the "dim impossible"
 *  affordance — call site is ~250 invocations per UI update. */
export function anyOverlap(a: Uint32Array, b: Uint32Array): boolean {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if ((a[i] & b[i]) !== 0) return true;
  }
  return false;
}

/** Count set bits via SWAR. Fast enough at ~6k bits / 188 words to be the
 *  default reporter for the result list size. */
export function popcount(bits: Uint32Array): number {
  let total = 0;
  for (let i = 0; i < bits.length; i++) {
    let v = bits[i];
    v = v - ((v >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    total += (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  }
  return total;
}

/** Enumerate the set bit indices in ascending order. Caller usually caps
 *  output via `limit` because pathological queries (no radicals selected →
 *  every kanji) could return thousands. */
export function enumerate(
  bits: Uint32Array,
  limit: number = Infinity,
): number[] {
  const out: number[] = [];
  for (let w = 0; w < bits.length && out.length < limit; w++) {
    let v = bits[w];
    while (v !== 0 && out.length < limit) {
      // Trailing-zero count via Math.log2 of the lowest set bit.
      const t = v & -v;
      const lsb = 31 - Math.clz32(t);
      out.push((w << 5) | lsb);
      v ^= t;
    }
  }
  return out;
}

/** True iff no bit is set. Cheaper than `popcount(bits) === 0`. */
export function isEmpty(bits: Uint32Array): boolean {
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] !== 0) return false;
  }
  return true;
}
