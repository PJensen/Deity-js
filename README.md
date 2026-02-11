# Deity-JS

A headless mood engine for games, simulations, and operating systems.

The deity doesn't think. It accounts. Every interaction is ledgered, weighed, and judged through a personality you define. The result is something that *feels* alive without a single neuron — just counters, thresholds, decay curves, and opacity.

Inspired by NetHack's god system: deterministic accounting wrapped in mystery.

## How it works

The deity maintains a **ledger** of every interaction — offerings, prayers, desecrations, world actions, and neglect. Nothing is deleted; older entries decay exponentially in weight.

From this ledger, a **mood** is derived: a 6-dimensional vector of `wrath`, `serenity`, `hunger`, `amusement`, `sorrow`, and `chaos`. Mood is recomputed at tick boundaries and frozen between ticks — reads are always stable. A personality baseline acts as a gravitational attractor, pulling mood back toward the deity's nature. Hysteresis makes moods sticky: once the deity is angry, it stays angry.

A **supplicant model** (brain.js LSTM with frequency fallback) learns the player's behavior patterns and predicts their next move. When predictions are correct, the deity grows bored. When surprised, chaos spikes. The ML doesn't model the god — it models *you*.

The deity emits **events** — `moodShift`, `wrath`, `demand`, `omen`, `miracle`, `utterance` — and never renders anything itself. Your game, your UI, your OS integration decides what those events look like.

`query()` lies a little. You never get the true mood vector. The opacity is the point.

## Install

```
npm install digital-deity
```

brain.js is optional. Without it, the supplicant model falls back to frequency-based prediction.

## Quick start

```js
const { Deity } = require('digital-deity');

const god = new Deity({
  name: "Mol'Khar",
  alignment: 'chaotic',
  personality: {
    wrath: 0.15,
    serenity: 0.3,
    hunger: 0.2,
    amusement: 0.15,
    sorrow: 0.1,
    chaos: 0.1,
  },
  favorMap: {
    kill: 0.6,
    steal: 0.4,
    heal: -0.3,
    protect: -0.1,
    destroy: 0.5,
    betray: 0.3,
  },
});

god.on('wrath', ({ intensity, tick }) => {
  console.log(`[tick ${tick}] Mol'Khar is wrathful (${intensity.toFixed(2)})`);
});

god.on('moodShift', ({ from, to }) => {
  console.log(`Mood shifted: ${from} → ${to}`);
});

god.on('demand', ({ intensity }) => {
  console.log(`The deity demands something.`);
});

// Offerings carry value and alignment
god.offer('unicorn_corpse', { value: 0.9, alignment: 'chaotic' });
god.offer('lichen_corpse', { value: 0.02 });

// World actions flow through the favor map
god.action('kill', { magnitude: 0.8, target: 'dragon' });
god.action('steal', { magnitude: 0.5, target: 'shopkeeper' });

// Prayer is risky — spam it and the deity notices
god.pray();

// Desecration is direct offense
god.desecrate('altar');

// Advance time — neglect is detected automatically
god.tick(10);

// Read mood (imprecise by design)
const state = god.query();
console.log(state.dominant); // { dimension: 'wrath', value: 0.42 }
```

## API

### `new Deity(opts)`

| Option | Type | Description |
|---|---|---|
| `name` | string | The deity's name |
| `alignment` | string | `'lawful'`, `'neutral'`, or `'chaotic'` |
| `personality` | object | Mood baseline attractor. Keys are mood dimensions, values 0–1. |
| `favorMap` | object | Maps action types to favor values (-1 to 1). Positive = pleased, negative = angered. |
| `moodOpts.hysteresis` | number | How sticky moods are (0–1). Default `0.3`. |
| `moodOpts.attractorStrength` | number | Pull toward personality baseline. Default `0.05`. |
| `ledgerOpts.decayHalfLife` | number | Ticks until an entry's weight halves. Default `100`. |
| `thresholds` | object | Mood thresholds for event triggers. |

### Methods

**`offer(type, meta)`** — Make an offering. `meta.value` (0–1) is intrinsic worth. `meta.alignment` modulates against the deity's alignment.

**`action(type, meta)`** — Report a world event. `type` is matched against `favorMap`. `meta.magnitude` (0–1) scales the reaction.

**`pray()`** — Ask for attention. Well-timed prayer soothes. Spam angers.

**`desecrate(type)`** — Direct offense. Wrath and chaos rise.

**`tick(dt)`** — Advance time. Neglect is detected automatically. Mood is resolved from ledger state.

**`query()`** — Read current mood. Returns `{ mood, dominant, tick }`. Imprecise by design — deterministic within a tick.

**`on(event, fn)`** — Subscribe to events. Returns an unsubscribe function.

**`serialize()` / `Deity.deserialize(data)`** — Full state round-trip for persistence across sessions.

### Events

| Event | Fires when | Data |
|---|---|---|
| `moodShift` | Dominant mood dimension changes | `{ from, to, mood, tick }` |
| `wrath` | Wrath exceeds threshold | `{ intensity, tick }` |
| `demand` | Hunger exceeds threshold | `{ intensity, tick }` |
| `omen` | Chaos exceeds threshold | `{ intensity, tick }` |
| `miracle` | High serenity + low wrath + rare chance | `{ serenity, tick }` |
| `utterance` | Probabilistic, mood-dependent | `{ mood, dominant, surprise, tick }` |

### Mood dimensions

`wrath` · `serenity` · `hunger` · `amusement` · `sorrow` · `chaos`

Normalized to sum to 1. The deity exists in blended emotional space — wrathful-but-amused, serene-but-hungry.

## Architecture

```
┌─────────────────────────────────────────────┐
│                   Deity                     │
│                                             │
│  ┌─────────┐   ┌──────┐   ┌────────────┐    │
│  │ Ledger  │─▶│ Mood │   │ Supplicant │    │
│  │         │   │      │   │  (ML/freq) │    │
│  │ entries │   │ 6D   │   │            │    │
│  │ decay   │   │ vec  │   │ predicts   │    │
│  │ weights │   │ hyst │   │ surprises  │    │
│  └─────────┘   └──┬───┘   └─────┬──────┘    │
│                   │              │          │
│              ┌────▼──────────────▼────┐     │
│              │    Event Emitter       │     │
│              │  moodShift · wrath     │     │
│              │  demand · omen         │     │
│              │  miracle · utterance   │     │
│              └────────────┬───────────┘     │
│                           │                 │
└───────────────────────────┼─────────────────┘
                            │
                    callbacks to your
                    game / UI / OS / whatever
```

## Design principles

**Mood is derived, not stored.** It's always a function of ledger state at the current tick boundary.

**Neglect is an input.** The absence of interaction is itself an interaction. The deity notices when you're gone.

**Opacity is the contract.** `query()` returns a fuzzed read. The consumer never gets the full truth. You learn the deity by interacting with it, the same way it learns you.

**The ML models the player, not the god.** The deity doesn't need intelligence. It needs accounting. Intelligence is projected onto it by the player because the rules are hidden.

**Callbacks are the only interface.** The deity never renders, never reaches out. It emits events and the world decides what they mean.

## Integration targets

This engine is environment-agnostic. Potential integration points:

- **Roguelikes / RPGs** — direct NetHack-style deity systems
- **Simulations** — ambient AI with emergent personality
- **Chat interfaces** — mood-modulated response generation
- **OS integration** — subscribe to system events, emit through native notification infrastructure
- **Physical installations** — hardware callbacks for light, sound, motion

## License

MIT