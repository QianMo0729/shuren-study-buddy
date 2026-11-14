import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CAMPUS, CAMPUS_PLACES, MAX_BUILDING_ACCURACY_M, NO_LOCATION_LABEL, OFF_CAMPUS_LABEL,
  allPlaceLabels, getCampusPlace, isValidGeo, resolveLocation,
} from '../shared/campusPlaces.ts';

test('source catalog covers three libraries, teaching buildings, and individual dorms without fabricated missing numbers', () => {
  assert.equal(CAMPUS_PLACES.length, 52);
  assert.equal(new Set(CAMPUS_PLACES.map((place) => place.id)).size, 52);
  assert.equal(CAMPUS_PLACES.filter((place) => place.category === 'library').length, 3);
  assert.equal(CAMPUS_PLACES.filter((place) => place.category === 'teaching').length, 3);
  assert.equal(CAMPUS_PLACES.filter((place) => place.category === 'dormitory').length, 46);
  assert.equal(getCampusPlace('liyuan-5'), undefined);
  assert.equal(getCampusPlace('chuangyuan-3'), undefined);
  for (const place of CAMPUS_PLACES) {
    assert.match(place.sourceUrl, /^https:\/\//);
    if (place.automatic) assert.ok(place.polygon && place.polygon.length >= 3, place.id);
    for (const ring of [place.polygon ?? [], ...(place.holes ?? [])]) {
      for (const point of ring) assert.ok(point.length === 2 && point.every(Number.isFinite), `${place.id}: [经度, 纬度]`);
    }
    const result = resolveLocation({ lat: place.lat, lng: place.lng, accuracy: 5 });
    assert.equal(result.placeId, place.automatic ? place.id : null, place.id);
  }
});

test('independent official/library and verified Dorm 15 anchors map to the actual building', () => {
  const anchors = [
    { lat: 22.597928963157898, lng: 113.99337295263159, expected: 'lynn-library' },
    { lat: 22.6044573, lng: 113.99197118, expected: 'hanyong-library' },
    { lat: 22.60504180349547, lng: 113.9952891995979, expected: 'dorm-15' },
  ];
  for (const { expected, ...point } of anchors) assert.equal(resolveLocation({ ...point, accuracy: 5 }).placeId, expected);
});

test('a location error circle spanning nearby dorms returns campus instead of picking a nearest dorm', () => {
  const one = getCampusPlace('liyuan-1')!;
  const two = getCampusPlace('liyuan-2')!;
  const between = { lat: (one.lat + two.lat) / 2, lng: (one.lng + two.lng) / 2, accuracy: 20 };
  assert.deepEqual(resolveLocation(between), { label: CAMPUS.name, placeId: null, precision: 'campus', reason: 'ambiguous' });
  const edge = one.polygon![0];
  assert.equal(resolveLocation({ lat: edge[1], lng: edge[0], accuracy: 5 }).precision, 'campus');
});

test('building courtyards are excluded and poor GPS precision cannot widen recognition', () => {
  const teaching = getCampusPlace('teaching-2')!;
  const courtyard = teaching.holes![0];
  const insideCourtyard = {
    lng: courtyard.reduce((sum, point) => sum + point[0], 0) / courtyard.length,
    lat: courtyard.reduce((sum, point) => sum + point[1], 0) / courtyard.length,
    accuracy: 1,
  };
  assert.equal(resolveLocation(insideCourtyard).precision, 'campus');
  for (const place of CAMPUS_PLACES) {
    const result = resolveLocation({ lat: place.lat, lng: place.lng, accuracy: MAX_BUILDING_ACCURACY_M + 1 });
    assert.equal(result.placeId, null, place.id);
    assert.equal(result.label, CAMPUS.name, place.id);
    assert.equal(result.reason, 'poor-accuracy', place.id);
  }
});

test('Yidan is the east wing of SUSTech Center; the rest of the center is not Yidan', () => {
  const yidan = getCampusPlace('yidan-library')!;
  assert.equal(yidan.automatic, true);
  assert.equal(resolveLocation({ lat: yidan.lat, lng: yidan.lng, accuracy: 5 }).label, `${CAMPUS.short}·一丹图书馆`);
  // 社区导航里标注的一丹点位落在东翼内
  assert.equal(resolveLocation({ lat: 22.60036695712506, lng: 113.9931979856845, accuracy: 5 }).placeId, 'yidan-library');
  // 南科大中心西侧不是一丹
  assert.equal(resolveLocation({ lat: 22.59998770717294, lng: 113.9923345196037, accuracy: 5 }).label, CAMPUS.name);
  // 台阶形内院在楼外
  const courtyard = yidan.holes![0];
  const inCourtyard = {
    lng: courtyard.reduce((sum, point) => sum + point[0], 0) / courtyard.length,
    lat: courtyard.reduce((sum, point) => sum + point[1], 0) / courtyard.length,
    accuracy: 1,
  };
  assert.equal(resolveLocation(inCourtyard).placeId, null);
});

test('building lookups only accept catalogue IDs and every label is listed for the watermark font', () => {
  for (const invalid of ['__proto__', 'constructor', '<script>', '南科大·伪造地点', 'dorm-15 ', '']) {
    assert.equal(getCampusPlace(invalid), undefined);
  }
  assert.equal(getCampusPlace({ id: 'dorm-15' }), undefined);
  assert.ok(!allPlaceLabels().some((label) => label.includes('手选')), 'places can no longer be picked by hand');
  for (const place of CAMPUS_PLACES) assert.ok(allPlaceLabels().includes(`${CAMPUS.short}·${place.label}`));
  assert.ok(allPlaceLabels().includes(NO_LOCATION_LABEL));
});

test('invalid coordinates and distant positions never become campus buildings', () => {
  assert.equal(isValidGeo({ lat: 91, lng: 113, accuracy: 5 }), false);
  assert.equal(isValidGeo({ lat: 22, lng: 113, accuracy: -1 }), false);
  assert.equal(resolveLocation({ lat: NaN, lng: 113, accuracy: 5 }).label, NO_LOCATION_LABEL);
  assert.equal(resolveLocation(null).precision, 'none');
  assert.equal(resolveLocation({ lat: 39.9, lng: 116.4, accuracy: 100_000 }).label, OFF_CAMPUS_LABEL);
});
