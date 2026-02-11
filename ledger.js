/**
 * Ledger — records every interaction with exponential weight decay.
 *
 * Each entry has a type, metadata, a birth tick, and a weight that decays
 * over time: weight = 1.0 * (0.5)^(ticksAgo / decayHalfLife).
 *
 * Old interactions fade but never fully disappear, creating emergent memory.
 */

const DEFAULT_HALF_LIFE = 100;

export class Ledger {
  /**
   * @param {object} opts
   * @param {number} [opts.decayHalfLife] ticks until entry weight halves
   */
  constructor({ decayHalfLife = DEFAULT_HALF_LIFE } = {}) {
    this._halfLife = decayHalfLife;
    /** @type {Array<{type:string, tick:number, meta:object}>} */
    this._entries = [];
    this._tick = 0;
  }

  get size() { return this._entries.length; }

  /**
   * Record an interaction.
   * @param {string} type 'offer'|'action'|'pray'|'desecrate'|'neglect'
   * @param {object} [meta] arbitrary metadata
   */
  record(type, meta = {}) {
    this._entries.push({ type, tick: this._tick, meta });
  }

  /** Advance internal tick counter. */
  advanceTick(n = 1) { this._tick += n; }

  /**
   * Weight of an entry at the current tick.
   * @param {{tick:number}} entry
   */
  _weight(entry) {
    const age = Math.max(0, this._tick - entry.tick);
    return Math.pow(0.5, age / this._halfLife);
  }

  /**
   * Return entries of a given type, decorated with their current weight.
   * @param {string} type
   */
  ofType(type) {
    return this._entries
      .filter((e) => e.type === type)
      .map((e) => ({ ...e, weight: this._weight(e) }));
  }

  /** Sum of weights for entries of a given type. */
  weightedCount(type) {
    let sum = 0;
    for (const e of this._entries) {
      if (e.type === type) sum += this._weight(e);
    }
    return sum;
  }

  /** Ticks since the most recent entry of a given type. Infinity if never. */
  ticksSinceLast(type) {
    for (let i = this._entries.length - 1; i >= 0; i--) {
      if (this._entries[i].type === type) {
        return this._tick - this._entries[i].tick;
      }
    }
    return Infinity;
  }

  /** Number of distinct (type, offeringType/actionType) combos in recent memory. */
  variety() {
    const seen = new Set();
    for (const e of this._entries) {
      const sub = e.meta.offeringType || e.meta.actionType || '';
      seen.add(`${e.type}:${sub}`);
    }
    return seen.size;
  }

  /** Count of consecutive most-recent entries sharing the same type. */
  currentStreak(type) {
    let count = 0;
    for (let i = this._entries.length - 1; i >= 0; i--) {
      if (this._entries[i].type === type) count++;
      else break;
    }
    return count;
  }

  /** Most recent N entries (newest first). */
  recent(n) {
    return this._entries.slice(-n).reverse();
  }

  serialize() {
    return {
      halfLife: this._halfLife,
      tick: this._tick,
      entries: this._entries.map((e) => ({ ...e, meta: { ...e.meta } })),
    };
  }

  static deserialize(data) {
    const l = new Ledger({ decayHalfLife: data.halfLife });
    l._tick = data.tick;
    l._entries = data.entries.map((e) => ({ ...e, meta: { ...e.meta } }));
    return l;
  }
}

export default Ledger;
