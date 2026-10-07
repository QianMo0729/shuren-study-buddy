import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { Camera, CameraOff, ChevronLeft, MapPin, ShieldCheck, SwitchCamera } from 'lucide-react';
import type { Checkin, CheckinStats, CheckinVisibility } from '../../shared/types';
import { CAMPUS_PLACES, NO_LOCATION_LABEL, placeLabelFor } from '../../shared/campusPlaces';
import { api, ApiError, fileUrl } from '../lib/api';
import { ease } from '../lib/motion';
import { useToast } from '../lib/toast';
import { Button, Field, Segmented, Spinner, Textarea, Toggle } from '../components/ui';
import { Stamp } from '../components/brand';
import { checkinAlt } from '../components/checkin/CheckinCard';
import { useCheckinSession } from '../components/checkin/useCheckinSession';
import { useGeoLabel } from '../components/checkin/useGeoLabel';
import { captureFrame, useLiveCamera } from '../components/checkin/useLiveCamera';
import { Viewfinder } from '../components/checkin/Viewfinder';

const CAPTION_MAX = 200;
const VISIBILITY_OPTIONS = [
  { value: 'all', label: '所有同学' },
  { value: 'buddies', label: '仅搭子' },
];
const GEO_KEY = 'dz-checkin-geo';
const VIS_KEY = 'dz-checkin-visibility';
const PLACE_GROUPS = [...new Set(CAMPUS_PLACES.map((place) => place.group))];

// 只保存个人偏好（是否附带位置、默认可见范围）；读写失败时用默认值
const readPref = (key: string) => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const writePref = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch { /* 无痕模式等情况下忽略 */ }
};

/**
 * 实时拍照打卡：只能用网页相机现场拍摄（getUserMedia），页面上没有任何选择文件或相册的入口。
 * 快门 → 当前视频帧 → JPEG → 携带一次性拍照凭证提交 → 服务器盖上地点与北京时间后保存。
 */
export function CheckinCamera() {
  const nav = useNavigate();
  const toast = useToast();
  const captionId = useId();
  const placeId = useId();
  const [done, setDone] = useState<{ checkin: Checkin; stats: CheckinStats } | null>(null);
  const camera = useLiveCamera(!done);
  const live = camera.state.status === 'live';
  const session = useCheckinSession(live);
  // 水印默认带地点（浏览器会请求定位权限）；用户关掉后记住选择
  const [geoOn, setGeoOn] = useState(() => readPref(GEO_KEY) !== '0');
  // 先让相机完成权限与预览初始化，避免 iPhone 同时弹出相机和定位权限请求。
  const geo = useGeoLabel(geoOn && live && !done);
  // 不记住手选楼栋，避免下次去其他地方时仍带上旧地点。
  const [selectedPlace, setSelectedPlace] = useState('');
  const watermarkPlace = geoOn ? placeLabelFor(geo.location, selectedPlace) : NO_LOCATION_LABEL;
  const [visibility, setVisibility] = useState<CheckinVisibility>(() => (readPref(VIS_KEY) === 'buddies' ? 'buddies' : 'all'));
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(0);
  const [status, setStatus] = useState('');

  useEffect(() => writePref(GEO_KEY, geoOn ? '1' : '0'), [geoOn]);
  useEffect(() => writePref(VIS_KEY, visibility), [visibility]);
  useEffect(() => {
    if (camera.state.status === 'live') setStatus('相机已打开，可以拍照');
    else if (camera.state.status === 'blocked') setStatus('请点击开启相机预览');
    else if (camera.state.status === 'error') setStatus(camera.state.problem.title);
  }, [camera.state]);

  const shoot = async () => {
    const video = camera.videoRef.current;
    if (busy || !live || !video) return;
    // 按下快门的这一刻取帧
    const image = captureFrame(video);
    if (!image) {
      toast.error('拍照失败', '画面还没准备好，请稍后再试');
      return;
    }
    setFlash((n) => n + 1);
    setBusy(true);
    setStatus('正在提交，服务器盖章中…');
    try {
      const token = await session.take();
      const r = await api.checkins.create({
        token, image, caption: caption.trim(), visibility,
        location: geoOn ? geo.location : null,
        placeId: geoOn ? selectedPlace || null : null,
      });
      setDone(r);
      if (r.checkin.reviewPending) {
        setStatus('已提交，等待审核，暂未公开');
        toast.info('已提交，等待审核', '内容触发极高风险筛查，审核通过后公开。');
      } else {
        setStatus('打卡成功，服务器已盖章');
        toast.success('打卡成功', r.stats.streak > 1 ? `已连续打卡 ${r.stats.streak} 天` : '服务器已盖上时间和地点');
      }
    } catch (e) {
      session.renew();
      setStatus('打卡失败');
      toast.error('打卡失败', e instanceof ApiError ? e.message : '请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  const back = () => nav('/community?tab=checkin');

  return (
    <div className="mx-auto max-w-5xl pt-4 sm:pt-8">
      <button type="button" onClick={back} className="-ml-1 mb-3 inline-flex items-center gap-0.5 text-[14px] text-ink-2 hover:text-ink">
        <ChevronLeft size={17} /> 打卡
      </button>
      <header className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-1 border-b border-ink pb-4">
        <h1 className="font-display text-[30px] leading-tight tracking-[-0.02em] text-ink sm:text-[40px]">拍照打卡</h1>
        <p className="text-[14px] text-ink-2">现场拍摄，服务器盖章</p>
      </header>
      <p className="sr-only" role="status" aria-live="polite">{status}</p>

      {done ? (
        <Result result={done} onDone={back} onOpen={() => nav(`/community/checkins/${done.checkin.id}`, { replace: true })} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-8">
          <div className="min-w-0">
            {/* 保持视频挂载并参与布局；iPhone 恢复播放时不能从 display:none 状态启动。 */}
            <div className="-mx-4 sm:mx-0">
              <Viewfinder
                videoRef={camera.videoRef}
                width={camera.state.status === 'live' ? camera.state.width : 0}
                height={camera.state.status === 'live' ? camera.state.height : 0}
                live={live}
                placeLabel={watermarkPlace}
                clockOffset={session.offset}
              >
                {camera.state.status === 'error' ? (
                  <div className="absolute inset-0 overflow-y-auto bg-surface">
                    <CameraError title={camera.state.problem.title} desc={camera.state.problem.desc} onRetry={camera.state.problem.retry ? camera.retry : undefined} />
                  </div>
                ) : camera.state.status === 'blocked' ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-5 text-center text-white">
                    <Camera size={28} aria-hidden />
                    <p className="text-[15px]">点击后开启相机画面</p>
                    <Button type="button" onClick={camera.resumePreview} variant="primary">开启相机预览</Button>
                  </div>
                ) : !live && (
                  <div className="absolute inset-0 grid place-items-center text-[14px] text-white/80">
                    <span className="inline-flex items-center gap-2">
                      <Spinner className="text-white/80" />
                      {camera.state.status === 'paused' ? '页面在后台，相机已暂停' : '正在打开摄像头…'}
                    </span>
                  </div>
                )}
                <AnimatePresence>
                  {flash > 0 && (
                    <motion.div
                      key={flash}
                      className="pointer-events-none absolute inset-0 bg-white"
                      initial={{ opacity: 0.85 }}
                      animate={{ opacity: 0 }}
                      transition={{ duration: 0.35, ease }}
                    />
                  )}
                </AnimatePresence>
                {busy && (
                  <div className="absolute inset-0 grid place-items-center bg-[#0c1415]/45 text-[14px] text-white">
                    <span className="inline-flex items-center gap-2"><Spinner className="text-white" />服务器盖章中…</span>
                  </div>
                )}
              </Viewfinder>
            </div>

            {camera.state.status !== 'error' && (
              <div>
                <div className="mt-4 flex items-center justify-center gap-6">
                  <span className="size-11" aria-hidden />
                  <button
                    type="button"
                    onClick={() => void shoot()}
                    disabled={!live || busy}
                    aria-label="拍照并提交打卡"
                    className="group grid size-[72px] place-items-center rounded-full border-[3px] border-ink bg-surface transition-transform active:scale-95 disabled:opacity-40"
                  >
                    <span className="size-[56px] rounded-full bg-brand transition-colors group-hover:bg-brand-2 group-disabled:bg-ink-4" />
                  </button>
                  {camera.canSwitch ? (
                    <button
                      type="button"
                      onClick={camera.switchCamera}
                      disabled={busy}
                      aria-label={camera.facing === 'environment' ? '切换到前置摄像头' : '切换到后置摄像头'}
                      title="切换摄像头"
                      className="grid size-11 place-items-center rounded-full border border-line-strong bg-surface text-ink-2 transition-colors hover:text-ink disabled:opacity-40"
                    >
                      <SwitchCamera size={20} />
                    </button>
                  ) : (
                    <span className="size-11" aria-hidden />
                  )}
                </div>
                <div className="mt-2 text-center">
                  <button type="button" onClick={camera.retry} disabled={busy} className="rounded-md px-3 py-2 text-[13px] text-ink-3 underline underline-offset-4 hover:text-ink disabled:opacity-40">重新开启相机</button>
                </div>
              </div>
            )}
            {live && !session.ready && !busy && session.error && (
              <p className="mt-2 text-center text-[13px] text-danger" role="alert">{session.error}</p>
            )}
          </div>

          <div className="space-y-5">
            <Field label="谁可以看到" hint={visibility === 'all' ? '登录的同学都能看到（与你互相排除的人除外）。' : '只有和你互相感兴趣、正在私聊的搭子能看到。'}>
              <Segmented options={VISIBILITY_OPTIONS} value={visibility} onChange={(v) => setVisibility(v as CheckinVisibility)} />
            </Field>

            <div>
              <Toggle checked={geoOn} onChange={(value) => { if (!busy) setGeoOn(value); }} label="在水印上显示地点" />
              {geoOn && (
                <div className="mt-3">
                  <label htmlFor={placeId} className="mb-1.5 block text-[14px] text-ink-2">所在楼栋</label>
                  <select
                    id={placeId}
                    value={selectedPlace}
                    onChange={(event) => setSelectedPlace(event.target.value)}
                    disabled={busy}
                    className="w-full rounded-xl border border-line-strong bg-surface px-3 py-2.5 text-[16px] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 disabled:opacity-50"
                  >
                    <option value="">自动识别楼栋</option>
                    {PLACE_GROUPS.map((group) => (
                      <optgroup key={group} label={group}>
                        {CAMPUS_PLACES.filter((place) => place.group === group).map((place) => (
                          <option key={place.id} value={place.id}>{place.label}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
              )}
              <p className="mt-2 flex items-start gap-1.5 text-[13px] leading-relaxed text-ink-3">
                <MapPin size={14} className="mt-[3px] shrink-0" aria-hidden />
                <span>
                  {!geoOn ? '不附带位置时，水印显示「未提供位置」。' : selectedPlace ? (
                    <>水印地点：<span className="text-ink-2">{watermarkPlace}</span><span className="block">请确认是当前所在楼栋；水印会注明「手选」。</span></>
                  ) : (
                    <>
                      {geo.state.status === 'off' && '相机准备好后获取位置，也可以先手选楼栋。'}
                      {geo.state.status === 'locating' && '正在定位…也可以手选所在楼栋。'}
                      {geo.state.status === 'ok' && <>
                        水印地点：<span className="text-ink-2">{watermarkPlace}</span>
                        {geo.location && <span className="block">定位精度约 ±{Math.ceil(geo.location.accuracy)} 米。</span>}
                        {geo.resolution.precision !== 'building' && <span className="block">暂时无法确认具体楼栋，请从上方选择。一丹图书馆需手选确认。</span>}
                      </>}
                      {geo.state.status === 'error' && `${geo.state.message}。可手选楼栋；不选择则显示「未提供位置」。`}
                    </>
                  )}
                  <span className="block">只把地点文字盖在照片上，不保存经纬度。</span>
                  {geoOn && <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="mt-1 block text-[11px] underline underline-offset-2">楼栋地图 © OpenStreetMap contributors</a>}
                </span>
              </p>
            </div>

            <Field label="说明" optional>
              <Textarea
                id={captionId}
                aria-label="打卡说明"
                value={caption}
                maxLength={CAPTION_MAX}
                onChange={(e) => setCaption(e.target.value.slice(0, CAPTION_MAX))}
                placeholder="今天在学什么？例如：线代第三章习题"
                className="min-h-20"
              />
            </Field>

            <WhyLive />
          </div>
        </div>
      )}
    </div>
  );
}

/** 为什么只能现场拍摄 */
function WhyLive() {
  return (
    <div className="rounded-md bg-paper-2 px-4 py-3 text-[13px] leading-relaxed text-ink-2">
      <p className="flex items-center gap-1.5 font-semibold text-ink">
        <ShieldCheck size={15} aria-hidden /> 为什么不能从相册上传？
      </p>
      <p className="mt-1">
        打卡记录的是「此时此地正在学习」。照片只能用网页相机现场拍摄，拍摄时间（北京时间）和地点由服务器盖章在照片右下角；相册里的旧照片无法证明这一点，所以不支持上传图片。
      </p>
    </div>
  );
}

function CameraError({ title, desc, onRetry }: { title: string; desc: string; onRetry?: () => void }) {
  return (
    <div className="rounded-md border border-line bg-surface px-5 py-5 text-center" role="alert">
      <CameraOff size={28} className="mx-auto text-ink-3" aria-hidden />
      <p className="mt-3 font-display text-[20px] text-ink">{title}</p>
      <p className="mx-auto mt-1.5 max-w-[30em] text-[14px] leading-relaxed text-ink-2">{desc}</p>
      {onRetry && (
        <Button type="button" variant="primary" className="mt-4" onClick={onRetry}>
          重试
        </Button>
      )}
    </div>
  );
}

function Result({ result, onDone, onOpen }: { result: { checkin: Checkin; stats: CheckinStats }; onDone: () => void; onOpen: () => void }) {
  const { checkin, stats } = result;
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease }} className="mx-auto max-w-[720px]">
      <div className="relative">
        <img src={fileUrl(checkin.image)} alt={checkinAlt(checkin)} className="block h-auto w-full rounded-md bg-mat" />
        {/* 服务器盖章成功：落一枚朱砂章 */}
        <motion.span
          className="absolute top-3 right-3"
          initial={{ scale: 1.6, opacity: 0, rotate: -14 }}
          animate={{ scale: 1, opacity: 1, rotate: -6 }}
          transition={{ type: 'spring', stiffness: 520, damping: 22, delay: 0.15 }}
        >
          <Stamp text="盖章" size={52} />
        </motion.span>
      </div>
      <div className="mt-4 rounded-md border border-line bg-surface p-4 sm:p-5">
        <p className="font-display text-[22px] text-ink">{checkin.reviewPending ? '已提交，等待审核' : '打卡成功'}</p>
        {checkin.reviewPending && <p className="mt-2 text-[14px] text-ink-2">暂未公开：{checkin.reviewReasons.join('；')}。审核通过后显示。</p>}
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-[14px] sm:grid-cols-2">
          <div>
            <dt className="text-[12.5px] text-ink-3">地点</dt>
            <dd className="text-ink">{checkin.placeLabel}</dd>
          </div>
          <div>
            <dt className="text-[12.5px] text-ink-3">服务器时间</dt>
            <dd className="text-ink tabular">{checkin.stampText}</dd>
          </div>
          <div>
            <dt className="text-[12.5px] text-ink-3">连续打卡</dt>
            <dd className="text-ink tabular">{stats.streak} 天（累计 {stats.total} 次）</dd>
          </div>
          <div>
            <dt className="text-[12.5px] text-ink-3">可见范围</dt>
            <dd className="text-ink">{checkin.reviewPending ? '等待审核，暂未公开' : checkin.visibility === 'buddies' ? '仅搭子' : '所有同学'}</dd>
          </div>
        </dl>
        {checkin.caption && <p className="mt-3 text-[15px] leading-relaxed whitespace-pre-wrap break-words text-ink">{checkin.caption}</p>}
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="primary" size="lg" onClick={onDone}>完成</Button>
          <Button variant="secondary" size="lg" onClick={onOpen}>查看这条打卡</Button>
        </div>
      </div>
    </motion.div>
  );
}
