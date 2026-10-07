import assert from 'node:assert/strict';
import test from 'node:test';
import { ALL_MAJORS, canonicalMajor, collegeOf } from '../shared/majors.ts';
import { emptyProfile, pickProfileInput } from '../shared/profileRules.ts';

test('major choices normalize only unambiguous aliases and preserve distinct degrees', () => {
  for (const value of ALL_MAJORS) assert.equal(canonicalMajor(value), value);
  assert.equal(canonicalMajor(' 计科 '), '计算机科学与技术');
  assert.equal(canonicalMajor('ＣＳ'), '计算机科学与技术');
  assert.equal(canonicalMajor('计算机系'), null, 'a department can contain several degrees');
  for (const value of ['constructor', '__proto__', 'toString', '任意新专业']) assert.equal(canonicalMajor(value), null);
  assert.equal(canonicalMajor(undefined), null);
  assert.equal(canonicalMajor(''), '');
  assert.equal(collegeOf(canonicalMajor('计科')!), '计算机科学与工程系');
});

test('unrecognized legacy major remains recoverable and time slots are not remigrated', () => {
  const original = { ...emptyProfile(), major: '旧院系名称', schedule: [0, 10, 61] };
  const restored = pickProfileInput(original);
  assert.equal(restored.major, original.major);
  assert.deepEqual(restored.schedule, original.schedule);
  assert.equal(pickProfileInput({ ...original, major: '计科' }).major, '计算机科学与技术');
});
