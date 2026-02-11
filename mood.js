/**
 * Mood — the deity's emotional state.
 *
 * Mood is a 6-dimensional vector:
 *   [wrath, serenity, hunger, amusement, sorrow, chaos]
 *
 * It is DERIVED from ledger state at tick boundaries.
 * Between ticks, query() returns the same value — deterministic within a tick.
 *
 * Hysteresis: moods are sticky. Once entered, they resist leaving.
 */

const DIMENSIONS = ['wrath', 'serenity', 'hunger', 'amusement', 'sorrow', 'chaos'];

class Mood {
  /**
   * @param {object} personality - baseline attractor, e.g. { wrath: 0.1, serenity: 0.4, ... }
   * @param {object} opts
   * @param {number} opts.hysteresis - how sticky moods are (0-1, higher = stickier)
   * @param {number} opts.attractorStrength - how strongly mood drifts toward personality baseline
   */
  constructor(personality = {}, { hysteresis = 0.3, attractorStrength = 0.05 } = {}) {
    this.personality = Mood.normalize(Mood.fromPartial(personality));
    this.hysteresis = hysteresis;
    this.attractorStrength = attractorStrength;

    // Current resolved mood — starts at personality baseline
    this._vector = { ...this.personality };
    this._dirty = false;
    this._lastResolvedTick = -1;
  }

  /**
   * Fill in missing dimensions with equal share of remaining weight.
   */
  static fromPartial(partial) {
    const vec = {};
    let assigned = 0;
    for (const d of DIMENSIONS) {
      if (partial[d] !== undefined) {
        vec[d] = partial[d];
        assigned += partial[d];
      }
    }
    const remaining = Math.max(0, 1 - assigned);
    const unassigned = DIMENSIONS.filter((d) => partial[d] === undefined);
    const share = unassigned.length > 0 ? remaining / unassigned.length : 0;
    for (const d of unassigned) {
      vec[d] = share;
    }
    return vec;
  }

  /**
   * Normalize vector so dimensions sum to 1.
   */
  static normalize(vec) {
    const sum = DIMENSIONS.reduce((s, d) => s + Math.max(0, vec[d] || 0), 0);
    if (sum === 0) {
      // Uniform fallback
      const val = 1 / DIMENSIONS.length;
      const out = {};
      for (const d of DIMENSIONS) out[d] = val;
      return out;
    }
    const out = {};
    for (const d of DIMENSIONS) {
      out[d] = Math.max(0, vec[d] || 0) / sum;
    }
    return out;
  }

  /**
   * Resolve mood from ledger state. Called once per tick by the deity.
   * This is the core derivation — mood is a FUNCTION of history.
   *
   * @param {Ledger} ledger
   * @param {number} currentTick
   */
  resolve(ledger, currentTick) {
    if (currentTick === this._lastResolvedTick) return; // already resolved this tick

    const impulse = this._computeImpulse(ledger);
    const attractor = this._computeAttractor();

    // Blend: current mood + impulse + attractor pull
    const raw = {};
    for (const d of DIMENSIONS) {
      const current = this._vector[d];
      const imp = impulse[d] || 0;
      const att = attractor[d];

      // Hysteresis: resist change proportional to current value
      const resistance = current * this.hysteresis;
      const delta = imp + att;
      const effectiveDelta = delta > 0
        ? delta * (1 - resistance)
        : delta * (1 + resistance);

      raw[d] = current + effectiveDelta;
    }

    this._vector = Mood.normalize(raw);
    this._lastResolvedTick = currentTick;
  }

  /**
   * Compute impulse vector from recent ledger activity.
   * This is where interaction types map to mood shifts.
   */
  _computeImpulse(ledger) {
    const impulse = {};
    for (const d of DIMENSIONS) impulse[d] = 0;

    // ── Offerings (value-weighted) ──
    const offers = ledger.ofType('offer').filter((e) => !e.meta.synthetic);
    let offerImpact = 0;
    for (const o of offers) {
      const ev = o.meta.effectiveValue ?? (o.meta.value ?? 0.3);
      offerImpact += ev * o.weight;
    }
    if (offerImpact > 0) {
      impulse.serenity += offerImpact * 0.04;
      impulse.hunger -= offerImpact * 0.03;
      impulse.wrath -= offerImpact * 0.02;
    } else if (offerImpact < 0) {
      // Misaligned offering — an insult
      impulse.wrath -= offerImpact * 0.06; // negative * negative = positive wrath
      impulse.amusement += 0.01; // a little amused at the audacity
    }

    // Offering variety amuses
    const variety = ledger.variety();
    impulse.amusement += Math.min(variety * 0.02, 0.1);

    // ── World actions (favor-weighted) ──
    const actions = ledger.ofType('action');
    for (const a of actions) {
      const favor = a.meta.favor ?? 0;
      const mag = a.meta.magnitude ?? 0.3;
      const impact = favor * mag * a.weight;

      if (impact > 0) {
        // Deity approves
        impulse.serenity += impact * 0.03;
        impulse.amusement += impact * 0.02;
        impulse.wrath -= impact * 0.01;
      } else if (impact < 0) {
        // Deity disapproves
        impulse.wrath -= impact * 0.04; // negative impact → positive wrath
        impulse.sorrow -= impact * 0.02;
        impulse.serenity += impact * 0.02; // negative → reduces serenity
      }
    }

    // ── Prayer (risky) ──
    const prayWeight = ledger.weightedCount('pray');
    const prayStreak = ledger.currentStreak('pray');
    if (prayStreak > 2) {
      impulse.wrath += prayStreak * 0.05;
      impulse.amusement -= 0.03;
    } else if (prayWeight > 0 && prayWeight < 1.5) {
      impulse.serenity += 0.03;
    }

    // ── Desecration ──
    const desecrateWeight = ledger.weightedCount('desecrate');
    impulse.wrath += desecrateWeight * 0.1;
    impulse.chaos += desecrateWeight * 0.06;
    impulse.serenity -= desecrateWeight * 0.08;

    // ── Neglect ──
    const neglectWeight = ledger.weightedCount('neglect');
    const ticksSinceOffer = ledger.ticksSinceLast('offer');
    const ticksSincePray = ledger.ticksSinceLast('pray');
    const ticksSinceAny = Math.min(ticksSinceOffer, ticksSincePray);
    const neglectFactor = Math.min(ticksSinceAny / 20, 1);
    impulse.hunger += (neglectWeight * 0.03) + (neglectFactor * 0.05);
    impulse.sorrow += neglectFactor * 0.04;
    impulse.serenity -= neglectFactor * 0.03;

    // ── Repetition breeds contempt ──
    if (ledger.size > 0) {
      const last5 = ledger.recent(5);
      const types = last5.map((e) => e.type);
      const uniqueRatio = new Set(types).size / types.length;
      if (uniqueRatio < 0.5) {
        impulse.amusement -= 0.03;
        impulse.wrath += 0.02;
      }
    }

    return impulse;
  }

  /**
   * Compute attractor pull toward personality baseline.
   */
  _computeAttractor() {
    const pull = {};
    for (const d of DIMENSIONS) {
      pull[d] = (this.personality[d] - this._vector[d]) * this.attractorStrength;
    }
    return pull;
  }

  /**
   * Read current mood. Deterministic within a tick.
   * Returns a copy with slight imprecision — the deity is opaque.
   */
  query({ precise = false } = {}) {
    if (precise) {
      return { ...this._vector };
    }
    // Fuzzy read — add small noise but cache it per tick
    // Since we want determinism within a tick, noise is derived from vector itself
    const out = {};
    for (const d of DIMENSIONS) {
      const v = this._vector[d];
      // Deterministic "noise" based on value — always same within tick
      const noise = (Math.sin(v * 1000 + DIMENSIONS.indexOf(d)) * 0.02);
      out[d] = Math.max(0, Math.min(1, v + noise));
    }
    // Re-normalize after noise
    return Mood.normalize(out);
  }

  /**
   * Get the dominant mood dimension.
   */
  dominant() {
    const vec = this._vector;
    let max = -1;
    let dom = null;
    for (const d of DIMENSIONS) {
      if (vec[d] > max) {
        max = vec[d];
        dom = d;
      }
    }
    return { dimension: dom, value: max };
  }

  /**
   * Check if a dimension exceeds a threshold.
   */
  exceeds(dimension, threshold) {
    return (this._vector[dimension] || 0) > threshold;
  }

  serialize() {
    return {
      personality: { ...this.personality },
      vector: { ...this._vector },
      hysteresis: this.hysteresis,
      attractorStrength: this.attractorStrength,
      lastResolvedTick: this._lastResolvedTick,
    };
  }

  static deserialize(data) {
    const mood = new Mood(data.personality, {
      hysteresis: data.hysteresis,
      attractorStrength: data.attractorStrength,
    });
    mood._vector = { ...data.vector };
    mood._lastResolvedTick = data.lastResolvedTick;
    return mood;
  }
}

Mood.DIMENSIONS = DIMENSIONS;

module.exports = Mood;
