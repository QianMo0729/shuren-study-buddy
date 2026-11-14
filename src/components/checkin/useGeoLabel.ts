import { useEffect, useRef, useState } from 'react';
import { resolveLocation, type GeoInput } from '../../../shared/campusPlaces';

export type GeoState =
  | { status: 'off' }
  | { status: 'locating' }
  | { status: 'ok'; loc: GeoInput; at: number }
  | { status: 'error'; message: string; denied: boolean };

/** 定位够准时多久刷新一次 */
const REFRESH_MS = 30_000;
/** 还没定位到、或定位误差太大时，隔几秒再试一次（误差往往几秒内就会变小） */
const RETRY_MS = 4_000;
/** 超过这个时间的定位不再使用 */
const STALE_MS = 2 * 60_000;

/**
 * 打卡定位：打卡必须定位，地点由定位自动识别，不能手选。
 * 按顺序反复调用 getCurrentPosition（上一次结束才发下一次），定位误差超过 goodAccuracy 米时加快重试。
 * 经纬度随打卡发给服务器：服务器据此盖地点水印，并核对搭子两人是否在同一处。
 */
export function useGeoLabel(enabled: boolean, goodAccuracy: number) {
  const [state, setState] = useState<GeoState>({ status: enabled ? 'locating' : 'off' });
  const [attempt, setAttempt] = useState(0);
  const goodRef = useRef(goodAccuracy);
  goodRef.current = goodAccuracy;

  useEffect(() => {
    if (!enabled) {
      setState({ status: 'off' });
      return;
    }
    if (!('geolocation' in navigator)) {
      setState({ status: 'error', message: '这个浏览器不支持定位，请换用手机自带的浏览器', denied: false });
      return;
    }
    let cancelled = false;
    let timer = 0;
    setState((s) => (s.status === 'ok' ? s : { status: 'locating' }));
    const locate = () => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelled) return;
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
          setState({ status: 'ok', at: Date.now(), loc });
          timer = window.setTimeout(locate, loc.accuracy <= goodRef.current ? REFRESH_MS : RETRY_MS);
        },
        (err) => {
          if (cancelled) return;
          const denied = err.code === err.PERMISSION_DENIED;
          const message = denied
            ? '没有定位权限，打卡需要定位'
            : err.code === err.TIMEOUT ? '定位超时，正在重试' : '暂时无法定位，正在重试';
          // 之前定位成功过就保留上一次的结果，直到它过期
          setState((s) => (s.status === 'ok' && !denied && Date.now() - s.at < STALE_MS ? s : { status: 'error', message, denied }));
          if (!denied) timer = window.setTimeout(locate, RETRY_MS);
        },
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000 },
      );
    };
    locate();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, attempt]);

  const fresh = enabled && state.status === 'ok' && Date.now() - state.at < STALE_MS ? state.loc : null;
  const resolution = resolveLocation(fresh);
  return {
    state,
    location: fresh,
    label: resolution.label,
    resolution,
    /** 定位误差在上限以内 */
    precise: !!fresh && fresh.accuracy <= goodAccuracy,
    /** 重新请求定位（例如用户刚在系统设置里打开了权限） */
    retry: () => setAttempt((n) => n + 1),
  };
}
