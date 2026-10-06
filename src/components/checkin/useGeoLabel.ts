import { useEffect, useState } from 'react';
import { resolveLocation, type GeoInput } from '../../../shared/campusPlaces';

export type GeoState =
  | { status: 'off' }
  | { status: 'locating' }
  | { status: 'ok'; loc: GeoInput; at: number }
  | { status: 'error'; message: string };

const REFRESH_MS = 45_000;
/** 超过这个时间的定位不再使用，水印显示「未提供位置」 */
const STALE_MS = 3 * 60_000;

/**
 * 位置开关：打开时用 navigator.geolocation 定位并定期刷新。拒绝或失败也可以打卡，水印显示「未提供位置」。
 * 经纬度只发给服务器换算成地点文字，服务器不保存经纬度。
 */
export function useGeoLabel(enabled: boolean) {
  const [state, setState] = useState<GeoState>({ status: enabled ? 'locating' : 'off' });

  useEffect(() => {
    if (!enabled) {
      setState({ status: 'off' });
      return;
    }
    if (!('geolocation' in navigator)) {
      setState({ status: 'error', message: '当前浏览器不支持定位' });
      return;
    }
    let cancelled = false;
    setState((s) => (s.status === 'ok' ? s : { status: 'locating' }));
    const locate = () => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelled) return;
          setState({ status: 'ok', at: Date.now(), loc: { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy } });
        },
        (err) => {
          if (cancelled) return;
          const message = err.code === err.PERMISSION_DENIED
            ? '没有获得定位权限，可在浏览器设置中允许'
            : err.code === err.TIMEOUT ? '定位超时，稍后会自动重试' : '暂时无法定位';
          // 之前定位成功过就保留上一次的结果，直到它过期
          setState((s) => (s.status === 'ok' && err.code !== err.PERMISSION_DENIED && Date.now() - s.at < STALE_MS ? s : { status: 'error', message }));
        },
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
      );
    };
    locate();
    const timer = setInterval(locate, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled]);

  const fresh = enabled && state.status === 'ok' && Date.now() - state.at < STALE_MS ? state.loc : null;
  const resolution = resolveLocation(fresh);
  return { state, location: fresh, label: resolution.label, resolution };
}
