// 打卡地点目录：来源、数据许可和处理方法见 data/campusPlaces.sources.json。
// 使用 WGS84 原始建筑轮廓；有定位误差或邻楼歧义时不猜楼名。
// 修改名称后须重新生成水印点阵字形。服务器只保存地点文字，不保存经纬度。
import buildings from './data/campusBuildings.json';

/** GeoJSON 顺序：[经度, 纬度]。 */
export type Coordinate = [number, number];

export interface CampusPlace {
  id: string;
  label: string;
  category: 'library' | 'teaching' | 'dormitory';
  group: string;
  aliases: string[];
  /** 原始轮廓内的代表点；不是建筑入口或测绘坐标。 */
  lat: number;
  lng: number;
  /** 到最远轮廓顶点的距离，仅供诊断；不用于扩大自动匹配范围。 */
  radiusM: number;
  automatic: boolean;
  polygon?: Coordinate[];
  holes?: Coordinate[][];
  sourceUrl: string;
}

export interface GeoInput {
  lat: number;
  lng: number;
  /** 浏览器报告的定位精度（米）。 */
  accuracy: number;
}

export const CAMPUS = {
  name: '南方科技大学',
  short: '南科大',
  // 粗略显示中心；实际校内判定使用 OSM 校园边界，不使用此圆。
  center: { lat: 22.6025, lng: 113.994 },
  radiusM: 1200,
} as const;

/** 3 馆、3 教学楼、46 栋宿舍；一丹无独立核验轮廓，仅允许手选。 */
export const CAMPUS_PLACES = buildings.places as CampusPlace[];
const CAMPUS_BOUNDARY = buildings.campusBoundary as Coordinate[];
const BY_ID = new Map(CAMPUS_PLACES.map((place) => [place.id, place]));

export const NO_LOCATION_LABEL = '未提供位置';
export const OFF_CAMPUS_LABEL = '校外';
export const MANUAL_LOCATION_SUFFIX = '（手选）';
export const MAX_BUILDING_ACCURACY_M = 20;
/** 保留旧导出以兼容调用者；此值现在是上限，绝不再向外扩大建筑范围。 */
export const MAX_ACCURACY_TOLERANCE_M = MAX_BUILDING_ACCURACY_M;
const MAX_CAMPUS_BOUNDARY_TOLERANCE_M = 100;
const EARTH_RADIUS_M = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** 两点间的球面距离（米，haversine）。 */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isValidGeo(loc: unknown): loc is GeoInput {
  if (!loc || typeof loc !== 'object') return false;
  const { lat, lng, accuracy } = loc as Record<string, unknown>;
  return (
    typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90
    && typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= 180
    && typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= 100_000
  );
}

/** 只接受固定目录 ID，拒绝把任意文本作为水印地点。 */
export function getCampusPlace(id: unknown): CampusPlace | undefined {
  return typeof id === 'string' ? BY_ID.get(id) : undefined;
}

function insideRing(loc: GeoInput, ring: Coordinate[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > loc.lat) !== (yj > loc.lat) && loc.lng < ((xj - xi) * (loc.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 校园尺度下的局部等距投影，用于测量 GPS 点到轮廓线段的距离。 */
function edgeDistanceM(loc: GeoInput, ring: Coordinate[]): number {
  const xScale = EARTH_RADIUS_M * Math.cos(rad(loc.lat));
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = rad(ring[j][0] - loc.lng) * xScale;
    const ay = rad(ring[j][1] - loc.lat) * EARTH_RADIUS_M;
    const bx = rad(ring[i][0] - loc.lng) * xScale;
    const by = rad(ring[i][1] - loc.lat) * EARTH_RADIUS_M;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

/** 正值表示楼内，负值表示楼外；中庭孔洞也属于楼外。 */
function clearanceM(loc: GeoInput, polygon: Coordinate[], holes: Coordinate[][] = []): number {
  const distance = Math.min(edgeDistanceM(loc, polygon), ...holes.map((hole) => edgeDistanceM(loc, hole)));
  return insideRing(loc, polygon) && !holes.some((hole) => insideRing(loc, hole)) ? distance : -distance;
}

export interface ResolvedLocation {
  label: string;
  placeId: string | null;
  precision: 'building' | 'campus' | 'off-campus' | 'none';
  reason: 'matched' | 'poor-accuracy' | 'ambiguous' | 'outside-buildings' | 'outside-campus' | 'unavailable';
}

/**
 * 自动楼栋判断要求：精度不超过20米、误差圆完整处于建筑内、未与另一栋楼相交。
 * 不采用“最近楼栋”或给半径增加误差的方法，校园内无法区分时退回校园名。
 */
export function resolveLocation(loc: GeoInput | null): ResolvedLocation {
  if (!isValidGeo(loc)) return { label: NO_LOCATION_LABEL, placeId: null, precision: 'none', reason: 'unavailable' };
  const campusDistance = clearanceM(loc, CAMPUS_BOUNDARY);
  const inCampus = campusDistance >= -Math.min(loc.accuracy, MAX_CAMPUS_BOUNDARY_TOLERANCE_M);
  const coarse = (reason: ResolvedLocation['reason']): ResolvedLocation => inCampus
    ? { label: CAMPUS.name, placeId: null, precision: 'campus', reason }
    : { label: OFF_CAMPUS_LABEL, placeId: null, precision: 'off-campus', reason: 'outside-campus' };
  if (loc.accuracy > MAX_BUILDING_ACCURACY_M) return coarse('poor-accuracy');
  const candidates = CAMPUS_PLACES.flatMap((place) => {
    if (!place.automatic || !place.polygon) return [];
    const clearance = clearanceM(loc, place.polygon, place.holes);
    return clearance >= -loc.accuracy ? [{ place, clearance }] : [];
  });
  if (candidates.length === 1 && candidates[0].clearance > loc.accuracy + 0.1) {
    const place = candidates[0].place;
    return { label: `${CAMPUS.short}·${place.label}`, placeId: place.id, precision: 'building', reason: 'matched' };
  }
  return coarse(candidates.length ? 'ambiguous' : 'outside-buildings');
}

/** 合法手选优先，并明确标明来源；无效 ID 不得进入照片水印。 */
export function placeLabelFor(loc: GeoInput | null, placeId?: string | null): string {
  const selected = getCampusPlace(placeId);
  if (selected) return `${CAMPUS.short}·${selected.label}${MANUAL_LOCATION_SUFFIX}`;
  return resolveLocation(loc).label;
}

/** 自动及手选文字都须包含，确保服务器点阵字体覆盖全部名称与标记。 */
export function allPlaceLabels(): string[] {
  return [NO_LOCATION_LABEL, OFF_CAMPUS_LABEL, CAMPUS.name, ...CAMPUS_PLACES.flatMap((p) => {
    const label = `${CAMPUS.short}·${p.label}`;
    return [label, `${label}${MANUAL_LOCATION_SUFFIX}`];
  })];
}
