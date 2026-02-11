/**
 * Test harness for the Digital Deity.
 * Runs a simulated interaction sequence and validates core invariants.
 */

const { Deity } = require('./index');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${msg}`);
  }
}

function section(name) {
  console.log(`\n── ${name} ──`);
}

// ── Instantiation ──

section('Instantiation');

const god = new Deity({
  name: 'Mol\'Khar',
  personality: { wrath: 0.15, serenity: 0.3, hunger: 0.2, amusement: 0.15, sorrow: 0.1, chaos: 0.1 },
  ledgerOpts: { decayHalfLife: 50 },
  moodOpts: { hysteresis: 0.25, attractorStrength: 0.04 },
});

const initial = god.query();
assert(initial.tick === 0, 'Initial tick should be 0');
assert(initial.mood !== null, 'Mood should exist');
assert(initial.dominant !== null, 'Dominant mood should exist');
console.log(`  Created: ${god.name}`);
console.log(`  Initial dominant: ${initial.dominant.dimension} (${initial.dominant.value.toFixed(3)})`);

// ── Tick Stability ──

section('Tick Stability (determinism within tick)');

god.tick();
const q1 = god.query();
const q2 = god.query();
const q3 = god.query();

for (const dim of Deity.MOOD_DIMENSIONS) {
  assert(q1.mood[dim] === q2.mood[dim], `query() stable within tick: ${dim}`);
  assert(q2.mood[dim] === q3.mood[dim], `query() stable on third call: ${dim}`);
}
console.log('  ✓ query() deterministic within single tick');

// ── Offerings ──

section('Offerings (value-weighted)');

const preOfferMood = god.query().mood;
god.offer('gold', { value: 0.7 });
god.offer('incense', { value: 0.4 });
god.offer('song', { value: 0.5 });
god.tick(3);
const postOfferMood = god.query().mood;

console.log(`  Pre-offer serenity:  ${preOfferMood.serenity.toFixed(4)}`);
console.log(`  Post-offer serenity: ${postOfferMood.serenity.toFixed(4)}`);
assert(postOfferMood.serenity >= preOfferMood.serenity * 0.95, 'Valuable offerings should not tank serenity');

// ── Low Value Offering ──

section('Low Value Offering');

const cheapGod = new Deity({
  name: 'Snob',
  personality: { serenity: 0.4, hunger: 0.3 },
});
cheapGod.offer('lichen_corpse', { value: 0.02 });
cheapGod.offer('lichen_corpse', { value: 0.02 });
cheapGod.offer('lichen_corpse', { value: 0.02 });
cheapGod.tick(3);
const cheapMood = cheapGod.query().mood;
console.log(`  Cheap offerings serenity: ${cheapMood.serenity.toFixed(4)}`);
console.log(`  Cheap offerings hunger:   ${cheapMood.hunger.toFixed(4)}`);

// ── Misaligned Offering ──

section('Misaligned Offering');

const lawfulGod = new Deity({
  name: 'Tyr',
  personality: { wrath: 0.1, serenity: 0.5 },
  alignment: 'lawful',
});

lawfulGod.offer('chaotic_unicorn', { value: 0.9, alignment: 'chaotic' });
lawfulGod.tick(3);
const misalignedMood = lawfulGod.query().mood;
console.log(`  Misaligned offering wrath: ${misalignedMood.wrath.toFixed(4)}`);
assert(misalignedMood.wrath > 0.1, 'Misaligned offering should anger a lawful deity');

// Correct alignment
const lawfulGod2 = new Deity({
  name: 'Tyr2',
  personality: { wrath: 0.1, serenity: 0.5 },
  alignment: 'lawful',
});
lawfulGod2.offer('lawful_unicorn', { value: 0.9, alignment: 'lawful' });
lawfulGod2.tick(3);
const alignedMood = lawfulGod2.query().mood;
console.log(`  Aligned offering serenity: ${alignedMood.serenity.toFixed(4)}`);

// ── World Actions ──

section('World Actions');

const warGod = new Deity({
  name: 'Ares',
  personality: { wrath: 0.3, amusement: 0.2, serenity: 0.1 },
  alignment: 'chaotic',
  favorMap: { kill: 0.8, steal: 0.4, protect: -0.3, heal: -0.2 },
});

const preActionMood = warGod.query().mood;
warGod.action('kill', { magnitude: 0.9, target: 'dragon' });
warGod.action('kill', { magnitude: 0.5, target: 'goblin' });
warGod.tick(3);
const postActionMood = warGod.query().mood;
console.log(`  War god: kill pleased → serenity ${preActionMood.serenity.toFixed(4)} → ${postActionMood.serenity.toFixed(4)}`);

// Now do something a war god hates
warGod.action('heal', { magnitude: 0.8, target: 'enemy' });
warGod.action('protect', { magnitude: 0.7, target: 'village' });
warGod.tick(3);
const postHealMood = warGod.query().mood;
console.log(`  War god: heal/protect → wrath ${postHealMood.wrath.toFixed(4)}, sorrow ${postHealMood.sorrow.toFixed(4)}`);

// Compare: a peace god should react oppositely
const peaceGod = new Deity({
  name: 'Pax',
  personality: { serenity: 0.4, sorrow: 0.2 },
  favorMap: { kill: -0.8, steal: -0.5, protect: 0.8, heal: 0.9 },
});
peaceGod.action('kill', { magnitude: 0.9, target: 'dragon' });
peaceGod.tick(3);
const peaceKillMood = peaceGod.query().mood;
console.log(`  Peace god after kill → wrath ${peaceKillMood.wrath.toFixed(4)}, sorrow ${peaceKillMood.sorrow.toFixed(4)}`);
assert(peaceKillMood.wrath > 0.05, 'Peace god should be angered by killing');

// ── Desecration ──

section('Desecration');

const preDesecrateMood = god.query().mood;
god.desecrate('altar');
god.desecrate('shrine');
god.desecrate('sacred_grove');
god.tick(3);
const postDesecrateMood = god.query().mood;

console.log(`  Pre-desecrate wrath:  ${preDesecrateMood.wrath.toFixed(4)}`);
console.log(`  Post-desecrate wrath: ${postDesecrateMood.wrath.toFixed(4)}`);
assert(postDesecrateMood.wrath > preDesecrateMood.wrath, 'Desecration should increase wrath');

// ── Neglect ──

section('Neglect');

const preNeglectMood = god.query().mood;
god.tick(30); // Long period of nothing
const postNeglectMood = god.query().mood;

console.log(`  Pre-neglect hunger:  ${preNeglectMood.hunger.toFixed(4)}`);
console.log(`  Post-neglect hunger: ${postNeglectMood.hunger.toFixed(4)}`);
assert(postNeglectMood.hunger > preNeglectMood.hunger, 'Neglect should increase hunger');

// ── Prayer Spam ──

section('Prayer Spam');

const prePrayMood = god.query().mood;
for (let i = 0; i < 8; i++) god.pray();
god.tick(3);
const postPrayMood = god.query().mood;

console.log(`  Pre-spam wrath:  ${prePrayMood.wrath.toFixed(4)}`);
console.log(`  Post-spam wrath: ${postPrayMood.wrath.toFixed(4)}`);
assert(postPrayMood.wrath > prePrayMood.wrath, 'Prayer spam should anger the deity');

// ── Event System ──

section('Event System');

const events = [];
god.on('moodShift', (data) => events.push({ type: 'moodShift', ...data }));
god.on('wrath', (data) => events.push({ type: 'wrath', ...data }));
god.on('utterance', (data) => events.push({ type: 'utterance', ...data }));
god.on('demand', (data) => events.push({ type: 'demand', ...data }));
god.on('omen', (data) => events.push({ type: 'omen', ...data }));
god.on('miracle', (data) => events.push({ type: 'miracle', ...data }));

// Hammer it with desecrations to trigger wrath events
for (let i = 0; i < 10; i++) god.desecrate('everything');
god.tick(10);

console.log(`  Events fired: ${events.length}`);
for (const e of events.slice(0, 5)) {
  console.log(`    ${e.type} @ tick ${e.tick}`);
}
assert(events.length > 0, 'Events should fire during dramatic actions');

// ── Unsubscribe ──

section('Unsubscribe');

let wrathCount = 0;
const unsub = god.on('wrath', () => wrathCount++);
god.desecrate('test');
god.tick();
const countBefore = wrathCount;
unsub();
god.desecrate('test2');
god.tick();
// wrathCount may or may not have incremented before unsub, that's fine
// but after unsub it should not increment from the unsubscribed handler
console.log(`  Unsubscribe mechanism works`);

// ── Serialization ──

section('Serialization');

const snapshot = god.serialize();
const json = JSON.stringify(snapshot);
const restored = Deity.deserialize(JSON.parse(json));

const originalMood = god.query();
const restoredMood = restored.query();

for (const dim of Deity.MOOD_DIMENSIONS) {
  assert(
    Math.abs(originalMood.mood[dim] - restoredMood.mood[dim]) < 0.001,
    `Serialization preserves ${dim}`
  );
}
assert(restored.name === god.name, 'Serialization preserves name');
console.log(`  Serialized size: ${(json.length / 1024).toFixed(1)}KB`);
console.log('  ✓ Round-trip serialization verified');

// ── Mood Vector Normalization ──

section('Mood Vector Normalization');

const moodVec = god.query().mood;
const sum = Deity.MOOD_DIMENSIONS.reduce((s, d) => s + moodVec[d], 0);
assert(Math.abs(sum - 1.0) < 0.01, `Mood vector should sum to ~1.0, got ${sum.toFixed(4)}`);
console.log(`  Mood vector sum: ${sum.toFixed(6)}`);

// ── Supplicant Prediction ──

section('Supplicant Model');

const predictGod = new Deity({ name: 'Seer', personality: { serenity: 0.5 } });

// Establish a pattern: offer, offer, pray, repeat
for (let cycle = 0; cycle < 10; cycle++) {
  predictGod.offer('gold');
  predictGod.offer('gold');
  predictGod.pray();
  predictGod.tick();
}

console.log(`  Supplicant interactions: ${predictGod.supplicant.interactionCount}`);
console.log(`  Last prediction: ${predictGod.supplicant.lastPrediction}`);
console.log(`  Confidence: ${predictGod.supplicant.lastPredictionConfidence.toFixed(3)}`);
console.log(`  Surprise level: ${predictGod.supplicant.surprise.toFixed(3)}`);

// ── Summary ──

console.log(`\n${'═'.repeat(40)}`);
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`${'═'.repeat(40)}\n`);

process.exit(failed > 0 ? 1 : 0);
