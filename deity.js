/**
 * Deity — a headless mood machine.
 *
 * Deterministic accounting wrapped in mystery.
 * The consumer never sees the full truth.
 *
 * Architecture:
 *   Ledger (memory) → Mood (derived state) → Events (callbacks)
 *   Supplicant (ML model of the worshipper) modulates reactions
 */

import { Ledger } from './ledger.js';
import { Mood } from './mood.js';
import { Supplicant } from './supplicant.js';

const EVENTS = ['moodShift', 'utterance', 'demand', 'omen', 'miracle', 'wrath'];

export class Deity {
  /**
   * @param {object} opts
   * @param {object} opts.personality - mood baseline, e.g. { wrath: 0.1, serenity: 0.5, ... }
   * @param {string} opts.name - the deity's name
   * @param {object} opts.moodOpts - { hysteresis, attractorStrength }
   * @param {object} opts.ledgerOpts - { decayHalfLife }
   * @param {object} opts.supplicantOpts - { sequenceLength, trainInterval }
   * @param {object} opts.thresholds - mood thresholds for events
   * @param {string} opts.alignment - 'lawful', 'neutral', 'chaotic'
   * @param {object} opts.favorMap - maps action types to favor values (-1 to 1)
   */
  constructor({
    personality = {},
    name = 'The Unnamed',
    moodOpts = {},
    ledgerOpts = {},
    supplicantOpts = {},
    thresholds = {},
    alignment = 'neutral',
    favorMap = {},
    neglectThreshold = 3,
  } = {}) {
    this.name = name;
    this._alignment = alignment;
    this.ledger = new Ledger(ledgerOpts);
    this.mood = new Mood(personality, moodOpts);
    this.supplicant = new Supplicant(supplicantOpts);

    // How the deity feels about world actions.
    // Positive = pleased, negative = angered. -1 to 1.
    // Consumers define this per deity archetype.
    this._favorMap = {
      kill:    0.0,   // neutral by default — override per deity
      steal:   0.0,
      heal:    0.2,
      destroy: -0.1,
      create:  0.2,
      betray:  -0.3,
      protect: 0.3,
      ...favorMap,
    };

    // Event listeners
    this._listeners = {};
    for (const e of EVENTS) this._listeners[e] = [];

    // Thresholds for event triggers
    this._thresholds = {
      wrath: 0.4,
      miracle: 0.5,   // serenity must exceed this AND low wrath
      demand: 0.35,    // hunger exceeds this
      omen: 0.3,       // chaos exceeds this
      ...thresholds,
    };

    // Ticks of no direct interaction before neglect is recorded
    this._neglectThreshold = neglectThreshold;

    // Track previous dominant mood for shift detection
    this._prevDominant = null;

    // Tick counter
    this._tick = 0;
  }

  // ── Event System ──────────────────────────────────────────

  /**
   * Register a callback.
   * @param {string} event - one of EVENTS
   * @param {function} fn - callback receiving event data
   * @returns {function} unsubscribe function
   */
  on(event, fn) {
    if (!this._listeners[event]) {
      throw new Error(`Unknown event: ${event}. Valid: ${EVENTS.join(', ')}`);
    }
    this._listeners[event].push(fn);
    return () => {
      this._listeners[event] = this._listeners[event].filter((f) => f !== fn);
    };
  }

  _emit(event, data) {
    for (const fn of this._listeners[event] || []) {
      try {
        fn(data);
      } catch (e) {
        // Callbacks should not crash the deity
      }
    }
  }

  // ── Public API ────────────────────────────────────────────

  /**
   * Make an offering to the deity.
   * @param {string} type - what is offered (e.g. 'gold', 'corpse', 'artifact')
   * @param {object} meta - additional context
   * @param {number} meta.value - intrinsic worth (0-1). A lichen corpse is 0.05. A unicorn is 0.9.
   * @param {string} meta.alignment - offering's alignment. Matching the deity's pleases. Opposing offends.
   */
  offer(type = 'generic', meta = {}) {
    const value = Math.max(0, Math.min(1, meta.value ?? 0.3));
    const alignment = meta.alignment ?? 'neutral';

    // Alignment match/mismatch modulates effective value
    let effectiveValue = value;
    if (this._alignment) {
      if (alignment === this._alignment) effectiveValue *= 1.5;
      else if (alignment !== 'neutral' && alignment !== this._alignment) effectiveValue *= -0.5;
    }

    this.ledger.record('offer', {
      offeringType: type,
      value,
      effectiveValue,
      alignment,
      ...meta,
    });
    const surprise = this.supplicant.record('offer');
    this._modulateFromSurprise(surprise);
  }

  /**
   * Pray to the deity. Risky.
   */
  pray() {
    this.ledger.record('pray');
    const surprise = this.supplicant.record('pray');
    this._modulateFromSurprise(surprise);
  }

  /**
   * Commit a desecration.
   * @param {string} type - what was desecrated
   */
  desecrate(type = 'generic') {
    this.ledger.record('desecrate', { desecrationType: type });
    const surprise = this.supplicant.record('desecrate');
    this._modulateFromSurprise(surprise);
  }

  /**
   * Report a world action. The deity watches everything.
   *
   * Actions have a moral valence the deity interprets through its personality.
   * A war god is pleased by kills. A peace god is sorrowed.
   * Theft might amuse a trickster god or enrage a lawful one.
   *
   * @param {string} type - 'kill', 'steal', 'heal', 'destroy', 'create', 'betray', 'protect', etc.
   * @param {object} meta
   * @param {number} meta.magnitude - how significant (0-1). Killing a rat vs. killing a dragon.
   * @param {string} meta.target - what/who was acted upon
   */
  action(type, meta = {}) {
    const magnitude = Math.max(0, Math.min(1, meta.magnitude ?? 0.3));

    // Deity interprets actions through its favor map
    const favor = this._favorMap[type];

    this.ledger.record('action', {
      actionType: type,
      magnitude,
      favor: favor ?? 0,
      ...meta,
    });
    this.supplicant.record('offer'); // actions are observed inputs
  }

  /**
   * Query the deity's mood. Imprecise by design.
   * Deterministic within a tick.
   */
  query() {
    return {
      mood: this.mood.query(),
      dominant: this.mood.dominant(),
      tick: this._tick,
    };
  }

  /**
   * Precise mood read — for internal/debug use only.
   */
  _queryPrecise() {
    return this.mood.query({ precise: true });
  }

  /**
   * Advance time. This is the heartbeat.
   * @param {number} dt - ticks to advance (default 1)
   */
  tick(dt = 1) {
    for (let i = 0; i < dt; i++) {
      this._tick++;
      this.ledger.advanceTick(1);

      // Record neglect if no recent direct interaction
      const ticksSinceOffer = this.ledger.ticksSinceLast('offer');
      const ticksSincePray = this.ledger.ticksSinceLast('pray');
      const ticksSinceDesecrate = this.ledger.ticksSinceLast('desecrate');
      const minTicksSince = Math.min(ticksSinceOffer, ticksSincePray, ticksSinceDesecrate);

      if (minTicksSince > this._neglectThreshold) {
        this.ledger.record('neglect', { synthetic: true });
        this.supplicant.record('neglect');
      }

      // Resolve mood from ledger state
      this.mood.resolve(this.ledger, this._tick);

      // Check for events
      this._checkEvents();
    }
  }

  // ── Internal ──────────────────────────────────────────────

  /**
   * Modulate mood based on supplicant prediction accuracy.
   * Surprise destabilizes. Predictability bores.
   */
  _modulateFromSurprise(surprise) {
    if (!surprise || surprise.predicted === null) return;

    if (surprise.surprised) {
      // The deity didn't see that coming — chaos and amusement spike
      this.ledger.record('offer', { offeringType: '_surprise_bonus', synthetic: true });
    } else if (this.supplicant.omniscient) {
      // The deity knows you completely — it grows bored, hunger rises
      this.ledger.record('neglect', { synthetic: true, reason: 'predictability' });
    }
  }

  /**
   * Check mood thresholds and emit events.
   */
  _checkEvents() {
    const precise = this._queryPrecise();
    const dom = this.mood.dominant();

    // Mood shift detection
    if (this._prevDominant && this._prevDominant !== dom.dimension) {
      this._emit('moodShift', {
        from: this._prevDominant,
        to: dom.dimension,
        mood: this.mood.query(),
        tick: this._tick,
      });
    }
    this._prevDominant = dom.dimension;

    // Wrath event
    if (precise.wrath > this._thresholds.wrath) {
      this._emit('wrath', {
        intensity: precise.wrath,
        tick: this._tick,
      });
    }

    // Demand event — hunger-driven
    if (precise.hunger > this._thresholds.demand) {
      this._emit('demand', {
        intensity: precise.hunger,
        tick: this._tick,
      });
    }

    // Omen event — chaos-driven
    if (precise.chaos > this._thresholds.omen) {
      this._emit('omen', {
        intensity: precise.chaos,
        tick: this._tick,
      });
    }

    // Miracle — requires high serenity, low wrath, and some randomness
    if (
      precise.serenity > this._thresholds.miracle &&
      precise.wrath < 0.1 &&
      this._miracleChance()
    ) {
      this._emit('miracle', {
        serenity: precise.serenity,
        tick: this._tick,
      });
    }

    // Utterance — probabilistic, mood-dependent
    if (this._shouldSpeak()) {
      this._emit('utterance', {
        mood: this.mood.query(),
        dominant: dom,
        surprise: this.supplicant.surprise,
        tick: this._tick,
      });
    }
  }

  /**
   * Deterministic-ish miracle chance seeded from tick.
   * Rare — roughly 2% per tick when conditions are met.
   */
  _miracleChance() {
    // Deterministic within tick: use tick number as seed
    return (Math.sin(this._tick * 127.1) * 0.5 + 0.5) < 0.02;
  }

  /**
   * Should the deity speak this tick?
   * ~10% chance, higher during mood extremes.
   */
  _shouldSpeak() {
    const dom = this.mood.dominant();
    const baseChance = 0.1;
    const extremeBoost = dom.value > 0.5 ? 0.15 : 0;
    const threshold = baseChance + extremeBoost;
    // Deterministic within tick
    return (Math.sin(this._tick * 43.7 + 17.3) * 0.5 + 0.5) < threshold;
  }

  // ── Serialization ─────────────────────────────────────────

  serialize() {
    return {
      name: this.name,
      alignment: this._alignment,
      favorMap: { ...this._favorMap },
      tick: this._tick,
      ledger: this.ledger.serialize(),
      mood: this.mood.serialize(),
      supplicant: this.supplicant.serialize(),
      thresholds: { ...this._thresholds },
      neglectThreshold: this._neglectThreshold,
      prevDominant: this._prevDominant,
    };
  }

  static deserialize(data) {
    const deity = new Deity({
      name: data.name,
      alignment: data.alignment,
      favorMap: data.favorMap,
      thresholds: data.thresholds,
      neglectThreshold: data.neglectThreshold,
    });
    deity._tick = data.tick;
    deity.ledger = Ledger.deserialize(data.ledger);
    deity.mood = Mood.deserialize(data.mood);
    deity.supplicant = Supplicant.deserialize(data.supplicant);
    deity._prevDominant = data.prevDominant;
    return deity;
  }
}

Deity.EVENTS = EVENTS;
Deity.MOOD_DIMENSIONS = Mood.DIMENSIONS;
