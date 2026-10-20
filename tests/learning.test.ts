import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyProfile } from '../shared/profileRules.ts';
import type { DimensionKey, FeedbackAction, ProfileInput, RecommendationInfo } from '../shared/types.ts';
import {
  DIMENSION_KEYS, ETA, FEATURE_KEYS, type Features, type PreferenceModel,
  blendWeight, defaultPrior, emphasis, extractFeatures, fitGlobalPrior, onlineUpdate, parseFeatures, parseModel,
  personalizedScore, predict, sameField, serializeModel,
} from '../server/learning.ts';
import { DIMENSION_WEIGHTS } from '../server/recommendations.ts';

/** 可重复的伪随机数 */
function rng(seed: number) {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function features(patch: Partial<Features> = {}): Features {
  const out = {} as Features;
  for (const key of FEATURE_KEYS) out[key] = 0.5;
  return { ...out, type_quiet: 1, type_discuss: 0, type_checkin: 0, type_flexible: 0, sameField: 0, ...patch };
}

function rec(similarities: Partial<Record<DimensionKey, number | null>>, score = 70): RecommendationInfo {
  return {
    version: 'rules-v2', score, forMe: score, forThem: score, tier: 'good', coverage: 100, overlapHours: 4, commonSlots: [0, 1],
    reasons: [], cautions: [],
    dimensions: DIMENSION_KEYS.map((key) => {
      const s = key in similarities ? similarities[key]! : 0.5;
      return { key, label: key, weight: DIMENSION_WEIGHTS[key], similarity: s, forMe: s, forThem: s, detail: '' };
    }),
  };
}

const profile = (patch: Partial<ProfileInput> = {}): ProfileInput => ({ ...emptyProfile(), ...patch });

test('default prior follows questionnaire weights; other features start neutral', () => {
  const prior = defaultPrior();
  assert.equal(prior.bias, 0);
  for (const key of DIMENSION_KEYS) assert.equal(prior.weights[key], (8 * DIMENSION_WEIGHTS[key]) / 100);
  assert.equal(prior.weights.time, 2.4);
  for (const key of FEATURE_KEYS.filter((k) => !(DIMENSION_KEYS as string[]).includes(k))) assert.equal(prior.weights[key], 0, key);
  // A neutral candidate is exactly 50%.
  assert.equal(predict(prior, Object.fromEntries(FEATURE_KEYS.map((k) => [k, 0.5])) as Features), 0.5);
});

test('features never include gender, photos, grade, nickname or other identity attributes', () => {
  for (const key of FEATURE_KEYS) assert.doesNotMatch(key, /gender|photo|cover|grade|nick|name|age|mbti|email|student/i, key);
  const me = profile({ major: '数学与应用数学' });
  const base = profile({ studyType: 'discuss', major: '金融数学', frequency: 'weekly3', personality: { ...emptyProfile().personality, talk: 5 } });
  const info = rec({ time: 0.9, content: null, personality: 0.4 });
  const x = extractFeatures(info, me, base);
  // Changing identity-only fields must not change the vector.
  const disguised = extractFeatures(info, me, { ...base, gender: 'female', grade: 'y4', photos: ['0123456789abcdef01234567.png'], photoVisibility: 'public', mbti: 'ENFP', realName: '某某' });
  assert.deepEqual(disguised, x);
  assert.deepEqual(Object.keys(x).sort(), [...FEATURE_KEYS].sort());
  for (const value of Object.values(x)) assert.ok(value >= 0 && value <= 1);
});

test('feature extraction maps dimensions, study type, talk, intensity and field', () => {
  const me = profile({ major: '数学与应用数学' });
  const x = extractFeatures(rec({ time: 0.8, content: null, style: 0.15 }), me,
    profile({ studyType: 'checkin', major: '金融数学', frequency: 'daily', personality: { ...emptyProfile().personality, talk: 4 } }));
  assert.equal(x.time, 0.8);
  assert.equal(x.content, 0.5, 'missing dimensions are neutral');
  assert.equal(x.style, 0.15);
  assert.deepEqual([x.type_quiet, x.type_discuss, x.type_checkin, x.type_flexible], [0, 0, 1, 0]);
  assert.equal(x.talk, 0.75);
  assert.equal(x.intensity, 1);
  assert.equal(x.sameField, 1, 'same college counts as same field');
  const other = extractFeatures(rec({}), me, profile({ studyType: 'quiet', major: '化学', frequency: '' }));
  assert.equal(other.talk, 0.5, 'unanswered talk is neutral');
  assert.equal(other.intensity, 0.5);
  assert.equal(other.sameField, 0);
  for (const [frequency, value] of [['weekly3', 0.75], ['weekly1', 0.4], ['irregular', 0.3]] as const) {
    assert.equal(extractFeatures(rec({}), me, profile({ frequency })).intensity, value);
  }
  assert.equal(sameField(profile({ major: '其他专业' }), profile({ major: '其他专业' })), false, 'the catch-all group is not a field');
  assert.equal(sameField(profile({ major: '' }), profile({ major: '' })), false);
  assert.equal(sameField(profile({ major: '化学' }), profile({ major: '化学' })), true);
});

test('stored snapshots are validated before training', () => {
  const x = features({ time: 1 });
  assert.deepEqual(parseFeatures(JSON.stringify(x)), x);
  assert.equal(parseFeatures('{}'), null);
  assert.equal(parseFeatures('not json'), null);
  assert.equal(parseFeatures(JSON.stringify({ ...x, time: 2 })), null);
  assert.equal(parseFeatures(JSON.stringify({ ...x, time: 'high' })), null);
  assert.deepEqual(parseFeatures(JSON.stringify({ ...x, gender: 1 })), x, 'unknown keys are dropped');
});

test('online updates learn only likes and dislikes; saved-for-later is neutral', () => {
  const prior = defaultPrior();
  const highTime = features({ time: 1 });
  const lowTime = features({ time: 0.1 });
  const liked = onlineUpdate(prior, prior, highTime, 'like');
  assert.ok(liked.weights.time > prior.weights.time);
  const disliked = onlineUpdate(prior, prior, lowTime, 'dislike');
  assert.ok(disliked.weights.time > prior.weights.time, 'disliking low-time candidates also raises the time weight');
  const skipped = onlineUpdate(prior, prior, lowTime, 'skip');
  assert.deepEqual(skipped, prior);
  assert.deepEqual(onlineUpdate(disliked, prior, lowTime, 'skip'), disliked, 'skip does not apply even regularization');
  // Exact formula for one step: w ← w − η (g (x − 0.5) + λ (w − w_prior)), g = (p − y) × sampleWeight.
  const p = predict(prior, lowTime);
  assert.ok(Math.abs(disliked.weights.time - (prior.weights.time - ETA * (p * (0.1 - 0.5)))) < 1e-12);
  // A reverse step approximately cancels the original update.
  const undone = onlineUpdate(disliked, prior, lowTime, 'dislike', -1);
  assert.ok(Math.abs(undone.weights.time - prior.weights.time) < 0.02);
});

test('consistent likes for high common time raise the time weight, emphasise it, and reorder candidates', () => {
  const prior = defaultPrior();
  const random = rng(7);
  let model: PreferenceModel = prior;
  let samples = 0;
  for (let i = 0; i < 30; i++) {
    const high = i % 2 === 0;
    const x = features({
      time: high ? 0.85 + random() * 0.15 : random() * 0.25,
      content: random(), personality: random(), style: random(), places: random(), interests: random(),
    });
    model = onlineUpdate(model, prior, x, high ? 'like' : 'dislike');
    samples++;
  }
  assert.ok(model.weights.time > prior.weights.time * 1.25, `time weight ${model.weights.time}`);
  assert.deepEqual(emphasis(model, prior, samples)[0], '共同时间');
  assert.ok(emphasis(model, prior, samples).length <= 2);
  assert.deepEqual(emphasis(model, prior, 4), [], 'too few samples never claim an emphasis');

  // Two probes: A has the better questionnaire score but little common time.
  const a = { score: 76, x: features({ time: 0.2, content: 1, style: 1 }) };
  const b = { score: 68, x: features({ time: 1, content: 0.4, style: 0.5 }) };
  const before = personalizedScore(a.score, predict(prior, a.x), 0) - personalizedScore(b.score, predict(prior, b.x), 0);
  assert.ok(before > 0, 'without feedback the questionnaire score decides');
  const after = personalizedScore(a.score, predict(model, a.x), samples) - personalizedScore(b.score, predict(model, b.x), samples);
  assert.ok(after < 0, `learned preference for common time reorders the pair (${after})`);
});

test('the prior and the blend ramp keep a few feedbacks from flipping the order', () => {
  const prior = defaultPrior();
  let model = prior;
  for (let i = 0; i < 3; i++) model = onlineUpdate(model, prior, features({ time: 1, content: 0 }), 'like');
  const a = { score: 76, x: features({ time: 0.2, content: 1, style: 1 }) };
  const b = { score: 68, x: features({ time: 1, content: 0.4, style: 0.5 }) };
  assert.ok(personalizedScore(a.score, predict(model, a.x), 3) > personalizedScore(b.score, predict(model, b.x), 3));
  assert.equal(blendWeight(0), 0);
  assert.equal(blendWeight(10), 0.225);
  assert.equal(blendWeight(20), 0.45);
  assert.equal(blendWeight(500), 0.45);
  assert.equal(personalizedScore(80, 0.1, 0), 80, 'no samples → pure questionnaire score');
  // L2 toward the prior bounds drift even after very many identical updates.
  let drifting = prior;
  for (let i = 0; i < 2_000; i++) drifting = onlineUpdate(drifting, prior, features({ interests: 1 }), 'like');
  for (const key of FEATURE_KEYS) assert.ok(Number.isFinite(drifting.weights[key]) && Math.abs(drifting.weights[key]) < 50, key);
});

test('global prior fitting learns site-wide preferences, stays near the default without signal, and is deterministic', () => {
  const random = rng(11);
  const samples: { features: Features; action: FeedbackAction }[] = [];
  for (let i = 0; i < 400; i++) {
    const places = random();
    const x = features({ places, time: random(), content: random() });
    samples.push({ features: x, action: places > 0.5 ? 'like' : random() < 0.5 ? 'dislike' : 'skip' });
  }
  const base = defaultPrior();
  const fitted = fitGlobalPrior(samples, base);
  assert.ok(fitted.weights.places > base.weights.places * 1.5, `places ${fitted.weights.places}`);
  assert.deepEqual(fitGlobalPrior(samples, base), fitted);
  assert.deepEqual(fitGlobalPrior([], base), base);
  assert.deepEqual(fitGlobalPrior([{ features: features({ time: 0 }), action: 'skip' }], base), base);
  assert.deepEqual(fitGlobalPrior(samples.filter((sample) => sample.action !== 'skip'), base), fitted, 'skip has no influence on the global prior');
  for (const key of FEATURE_KEYS) assert.ok(Number.isFinite(fitted.weights[key]));
});

test('models round-trip through storage with the bias, and corrupt data falls back to the prior', () => {
  const prior = defaultPrior();
  const model = onlineUpdate(prior, prior, features({ time: 1 }), 'like');
  const json = serializeModel(model);
  assert.ok('bias' in JSON.parse(json));
  const parsed = parseModel(json, prior);
  for (const key of FEATURE_KEYS) assert.ok(Math.abs(parsed.weights[key] - model.weights[key]) < 1e-4);
  assert.ok(Math.abs(parsed.bias - model.bias) < 1e-4);
  assert.deepEqual(parseModel('nonsense', prior), prior);
  assert.deepEqual(parseModel(JSON.stringify({ time: 'x', bias: Infinity }), prior), prior);
});
