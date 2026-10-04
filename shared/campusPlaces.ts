// 学习打卡的地点：把浏览器给出的经纬度换算成一句地点文字，盖在照片水印上。
//
// ⚠️ 下面所有坐标都是 WGS-84（GPS 原始坐标，不是高德/腾讯地图的 GCJ-02）近似值，
//    仅凭校园平面图估计，**上线前需实地校准**：到每个地点用手机上的 GPS 工具读取 WGS-84 坐标，
//    替换 lat/lng，并按建筑大小调整 radiusM。
//
// 修改或新增地点名称后，必须重新运行 `npx tsx scripts/gen-watermark-font.mjs` 生成点阵字体，
// 否则新出现的汉字无法盖到照片上（tests/watermark.test.ts 会检查字符集是否覆盖所有地点）。
// 服务器只保存换算后的地点文字，不保存经纬度。

export interface CampusPlace {
  id: string;
  label: string;
  lat: number;
  lng: number;
  /** 地点范围半径（米） */
  radiusM: number;
}

export interface GeoInput {
  lat: number;
  lng: number;
  /** 浏览器报告的定位精度（米） */
  accuracy: number;
}

export const CAMPUS = {
  name: '南方科技大学',
  short: '南科大',
  // 校园大致中心（近似值，待校准）
  center: { lat: 22.599, lng: 113.997 },
  radiusM: 1200,
} as const;

/** 常用学习地点（近似坐标，待实地校准） */
export const CAMPUS_PLACES: CampusPlace[] = [
  { id: 'lynn-library', label: '琳恩图书馆', lat: 22.5975, lng: 113.9963, radiusM: 70 },
  { id: 'yidan-library', label: '一丹图书馆', lat: 22.6012, lng: 113.9977, radiusM: 70 },
  { id: 'teaching-1', label: '第一教学楼', lat: 22.5966, lng: 113.9979, radiusM: 70 },
  { id: 'teaching-2', label: '第二教学楼', lat: 22.5995, lng: 113.9994, radiusM: 70 },
  { id: 'activity-center', label: '学生活动中心', lat: 22.5984, lng: 113.9946, radiusM: 60 },
  { id: 'stadium', label: '体育场', lat: 22.6003, lng: 113.9929, radiusM: 110 },
  { id: 'gym', label: '体育馆', lat: 22.6016, lng: 113.9945, radiusM: 70 },
  { id: 'zhiren', label: '致仁书院', lat: 22.5951, lng: 113.9944, radiusM: 120 },
  { id: 'shuren', label: '树仁书院', lat: 22.5957, lng: 113.9995, radiusM: 120 },
  { id: 'zhicheng', label: '致诚书院', lat: 22.6029, lng: 113.9957, radiusM: 120 },
  { id: 'shude', label: '树德书院', lat: 22.5938, lng: 113.9973, radiusM: 120 },
  { id: 'zhixin', label: '致新书院', lat: 22.6036, lng: 113.9996, radiusM: 120 },
  { id: 'shuli', label: '树礼书院', lat: 22.6021, lng: 114.0014, radiusM: 120 },
];

export const NO_LOCATION_LABEL = '未提供位置';
export const OFF_CAMPUS_LABEL = '校外';
/** 定位误差最多按 150 米容忍，避免精度很差的定位也被判定到某个地点 */
export const MAX_ACCURACY_TOLERANCE_M = 150;

const EARTH_RADIUS_M = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** 两点间的球面距离（米，haversine） */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 经纬度与精度是否为合法数值 */
export function isValidGeo(loc: unknown): loc is GeoInput {
  if (!loc || typeof loc !== 'object') return false;
  const { lat, lng, accuracy } = loc as Record<string, unknown>;
  return (
    typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90
    && typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= 180
    && typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= 100_000
  );
}

/**
 * 地点文字：未提供 →「未提供位置」；落在某个地点范围内（容许 min(精度, 150) 米误差）→「南科大·<地点>」，
 * 多个地点都符合时取最近的；在校园范围内 →「南方科技大学」；否则「校外」。
 */
export function placeLabelFor(loc: GeoInput | null): string {
  if (!loc || !isValidGeo(loc)) return NO_LOCATION_LABEL;
  const tolerance = Math.min(loc.accuracy, MAX_ACCURACY_TOLERANCE_M);
  let best: { place: CampusPlace; d: number } | null = null;
  for (const place of CAMPUS_PLACES) {
    const d = distanceM(loc, place);
    if (d <= place.radiusM + tolerance && (!best || d < best.d)) best = { place, d };
  }
  if (best) return `${CAMPUS.short}·${best.place.label}`;
  if (distanceM(loc, CAMPUS.center) <= CAMPUS.radiusM + tolerance) return CAMPUS.name;
  return OFF_CAMPUS_LABEL;
}

/** 水印可能出现的全部地点文字（生成点阵字体与测试用） */
export function allPlaceLabels(): string[] {
  return [NO_LOCATION_LABEL, OFF_CAMPUS_LABEL, CAMPUS.name, ...CAMPUS_PLACES.map((p) => `${CAMPUS.short}·${p.label}`)];
}
