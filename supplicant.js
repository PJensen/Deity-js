/**
 * Supplicant — frequency-based prediction model of the worshipper.
 *
 * Tracks interaction patterns and predicts the next action type.
 * When surprised (wrong prediction), reports high surprise.
 * When the player is fully predictable, reports omniscience.
 *
 * Pure frequency counting with recency weighting (no ML dependency).
 */

const DEFAULT_SEQUENCE_LENGTH = 10;

export class Supplicant {
  /**
   * @param {object} opts
   * @param {number} [opts.sequenceLength] how many recent interactions to consider
   */
  constructor({ sequenceLength = DEFAULT_SEQUENCE_LENGTH } = {}) {
    this._seqLen = sequenceLength;
    /** @type {string[]} */
    this._history = [];
    /** @type {Record<string,number>} */
    this._freq = {};
    this._totalInteractions = 0;
    this._correctPredictions = 0;
    this._lastPrediction = null;
    this._lastConfidence = 0;
    this._surprise = 0;
  }

  get interactionCount() { return this._totalInteractions; }
  get lastPrediction() { return this._lastPrediction; }
  get lastPredictionConfidence() { return this._lastConfidence; }
  get surprise() { return this._surprise; }

  /** True when predictions are nearly always correct. */
  get omniscient() {
    if (this._totalInteractions < 10) return false;
    return (this._correctPredictions / this._totalInteractions) > 0.85;
  }

  /**
   * Record an interaction and return surprise info.
   * @param {string} type
   * @returns {{ predicted: string|null, surprised: boolean }}
   */
  record(type) {
    const predicted = this._lastPrediction;
    const surprised = predicted !== null && predicted !== type;

    if (predicted === type) this._correctPredictions++;
    this._surprise = surprised
      ? Math.min(1, this._surprise + 0.3)
      : Math.max(0, this._surprise - 0.1);

    this._history.push(type);
    if (this._history.length > this._seqLen * 3) {
      this._history = this._history.slice(-this._seqLen * 2);
    }
    this._freq[type] = (this._freq[type] || 0) + 1;
    this._totalInteractions++;

    this._predict();

    return { predicted, surprised };
  }

  _predict() {
    const window = this._history.slice(-this._seqLen);
    const counts = {};
    for (const t of window) counts[t] = (counts[t] || 0) + 1;

    let bestType = null;
    let bestCount = 0;
    for (const [t, c] of Object.entries(counts)) {
      if (c > bestCount) { bestCount = c; bestType = t; }
    }

    this._lastPrediction = bestType;
    this._lastConfidence = window.length > 0 ? bestCount / window.length : 0;
  }

  serialize() {
    return {
      seqLen: this._seqLen,
      history: [...this._history],
      freq: { ...this._freq },
      total: this._totalInteractions,
      correct: this._correctPredictions,
      lastPrediction: this._lastPrediction,
      lastConfidence: this._lastConfidence,
      surprise: this._surprise,
    };
  }

  static deserialize(data) {
    const s = new Supplicant({ sequenceLength: data.seqLen });
    s._history = [...data.history];
    s._freq = { ...data.freq };
    s._totalInteractions = data.total;
    s._correctPredictions = data.correct;
    s._lastPrediction = data.lastPrediction;
    s._lastConfidence = data.lastConfidence;
    s._surprise = data.surprise;
    return s;
  }
}

export default Supplicant;
