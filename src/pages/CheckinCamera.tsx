import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Camera, CameraOff, MapPin, ShieldCheck } from 'lucide-react';
import { FlipIcon, PencilIcon, XIcon } from '../components/icons';
import type { Checkin, CheckinStats, CheckinVisibility } from '../../shared/types';
import { CAMPUS_PLACES, NO_LOCATION_LABEL, placeLabelFor } from '../../shared/campusPlaces';
import { api, ApiError, fileUrl } from '../lib/api';
import { ease } from '../lib/motion';
import { useToast } from '../lib/toast';
import { Button, Field, Modal, Segmented, Spinner, Textarea } from '../components/ui';
import { Stamp } from '../components/brand';
import { checkinAlt } from '../components/checkin/CheckinCard';
import { useCheckinSession } from '../components/checkin/useCheckinSession';
import { useGeoLabel } from '../components/checkin/useGeoLabel';
import { captureFrame, useLiveCamera } from '../components/checkin/useLiveCamera';
import { Viewfinder } from '../components/checkin/Viewfinder';
import { PHOTO_MUST, captionLength } from '../../shared/activity';
import { useActivityConfig } from '../lib/activity';

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
  const activity = useActivityConfig();
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

  const back = () => (window.history.state?.idx > 0 ? nav(-1) : nav('/community?tab=checkin'));
  const [noteOpen, setNoteOpen] = useState(false);
  const [lastPhoto, setLastPhoto] = useState<string | null>(null);
  // 左下角缩略图：自己最近一次打卡（拍完后换成这一张）
  useEffect(() => {
    let alive = true;
    api.checkins.list({ scope: 'mine' }).then((r) => { if (alive && r.items[0]) setLastPhoto(r.items[0].image); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  if (done) {
    return (
      <div className="fixed inset-0 z-[60] overflow-y-auto bg-paper px-4 pt-[calc(env(safe-area-inset-top)+16px)] pb-[calc(env(safe-area-inset-bottom)+24px)]">
        <p className="sr-only" role="status" aria-live="polite">{status}</p>
        <Result result={done} onDone={back} onOpen={() => nav(`/community/checkins/${done.checkin.id}`, { replace: true })} />
      </div>
    );
  }

  return (
    // 全屏黑底相机：顶部关闭与楼栋，中间取景（右下角实时水印），底部快门
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#0B0D0C] text-white">
      <p className="sr-only" role="status" aria-live="polite">{status}</p>

      <div className="flex h-11 shrink-0 items-center justify-between gap-3 px-4 mt-[calc(env(safe-area-inset-top)+10px)]">
        <button type="button" onClick={back} aria-label="关闭" className="grid size-9 place-items-center rounded-full bg-white/14">
          <XIcon size={16} width={2.4} />
        </button>
        <label className="relative flex h-9 min-w-0 items-center gap-1.5 rounded-full bg-white/14 px-3.5 text-[15px] font-semibold">
          <MapPin size={15} aria-hidden className="shrink-0" />
          <span className="truncate">{geoOn ? watermarkPlace : '不显示地点'}</span>
          <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden className="shrink-0"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          <span className="sr-only">水印上的地点</span>
          <select
            id={placeId}
            value={geoOn ? selectedPlace : 'off'}
            disabled={busy}
            onChange={(e) => {
              if (e.target.value === 'off') { setGeoOn(false); return; }
              setGeoOn(true);
              setSelectedPlace(e.target.value);
            }}
            className="absolute inset-0 cursor-pointer appearance-none opacity-0"
          >
            <option value="">自动识别楼栋</option>
            {PLACE_GROUPS.map((group) => (
              <optgroup key={group} label={group}>
                {CAMPUS_PLACES.filter((place) => place.group === group).map((place) => <option key={place.id} value={place.id}>{place.label}</option>)}
              </optgroup>
            ))}
            <option value="off">不显示地点</option>
          </select>
        </label>
        <button type="button" onClick={() => setNoteOpen(true)} aria-label="说明与可见范围" className="grid size-9 place-items-center rounded-full bg-white/14">
          <PencilIcon size={17} width={2} />
        </button>
      </div>

      <div className="mt-2.5 flex min-h-0 flex-1 items-center justify-center">
        <div className="w-full">
          {/* 保持视频挂载并参与布局；iPhone 恢复播放时不能从 display:none 状态启动。 */}
          <Viewfinder
            videoRef={camera.videoRef}
            width={camera.state.status === 'live' ? camera.state.width : 0}
            height={camera.state.status === 'live' ? camera.state.height : 0}
            live={live}
            placeLabel={watermarkPlace}
            clockOffset={session.offset}
          >
            {camera.state.status === 'error' ? (
              <div className="absolute inset-0 overflow-y-auto">
                <CameraError title={camera.state.problem.title} desc={camera.state.problem.desc} onRetry={camera.state.problem.retry ? camera.retry : undefined} />
              </div>
            ) : camera.state.status === 'blocked' ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-5 text-center">
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
                <motion.div key={flash} className="pointer-events-none absolute inset-0 bg-white" initial={{ opacity: 0.85 }} animate={{ opacity: 0 }} transition={{ duration: 0.35, ease }} />
              )}
            </AnimatePresence>
            {busy && (
              <div className="absolute inset-0 grid place-items-center bg-black/45 text-[14px]">
                <span className="inline-flex items-center gap-2"><Spinner className="text-white" />服务器盖章中…</span>
              </div>
            )}
          </Viewfinder>
        </div>
      </div>

      <p className="mt-3 shrink-0 px-6 text-center text-[13px] text-white/72">
        {live && !session.ready && !busy && session.error
          ? <span className="text-[#ff8a7a]" role="alert">{session.error}</span>
          : <>拍下正在学习的自己和学习内容 · <Link to="/rules#photo" className="text-white underline underline-offset-2">照片要求</Link></>}
      </p>

      <div className="mt-5 mb-[calc(env(safe-area-inset-bottom)+28px)] grid shrink-0 grid-cols-3 items-center">
        <div className="flex justify-center">
          {lastPhoto ? (
            <Link to="/me/content?view=checkins" aria-label="我的打卡" className="size-11 overflow-hidden rounded-[10px] border-[1.5px] border-white/80">
              <img src={fileUrl(lastPhoto)} alt="" className="h-full w-full object-cover" />
            </Link>
          ) : <span className="size-11" aria-hidden />}
        </div>
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => void shoot()}
            disabled={!live || busy}
            aria-label="拍照并提交打卡"
            className="size-[78px] rounded-full border-4 border-white p-1 transition-transform active:scale-95 disabled:opacity-40"
          >
            <span className="block h-full w-full rounded-full bg-white" />
          </button>
        </div>
        <div className="flex justify-center">
          {camera.canSwitch ? (
            <button
              type="button"
              onClick={camera.switchCamera}
              disabled={busy}
              aria-label={camera.facing === 'environment' ? '切换到前置摄像头' : '切换到后置摄像头'}
              className="grid size-11 place-items-center rounded-full bg-white/14 disabled:opacity-40"
            >
              <FlipIcon size={22} width={2} />
            </button>
          ) : (
            <button type="button" onClick={camera.retry} disabled={busy} aria-label="重新开启相机" className="grid size-11 place-items-center rounded-full bg-white/14 disabled:opacity-40">
              <FlipIcon size={22} width={2} />
            </button>
          )}
        </div>
      </div>

      <Modal open={noteOpen} onClose={() => setNoteOpen(false)} title="说明与可见范围" size="md">
        <div className="space-y-5 px-5 pt-2 pb-6 text-ink">
          <Field
            label="说明"
            optional
            hint={captionLength(caption) >= activity.config.captionMin
              ? '参加搭子打卡的话，这次打卡的说明已经够计分了。'
              : `参加搭子打卡的话，写一句学了什么（至少 ${activity.config.captionMin} 个字）才计分${caption.trim() ? `，还差 ${activity.config.captionMin - captionLength(caption)} 个字` : ''}。`}
          >
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
          <Field label="谁可以看到" hint={visibility === 'all' ? '登录的同学都能看到（与你互相排除的人除外）。' : '只有和你互相感兴趣、正在私聊的搭子能看到。'}>
            <Segmented options={VISIBILITY_OPTIONS} value={visibility} onChange={(v) => setVisibility(v as CheckinVisibility)} />
          </Field>
          {geoOn && <p className="text-[13px] leading-relaxed text-ink-3">{placeHint(geo, selectedPlace, watermarkPlace)}只把地点文字盖在照片上，不保存经纬度。</p>}
          <PhotoRules />
          <WhyLive />
          <Button variant="primary" size="lg" className="w-full" onClick={() => setNoteOpen(false)}>完成</Button>
        </div>
      </Modal>
    </div>
  );
}

/** 地点说明：手选、定位中、定位结果或失败 */
function placeHint(geo: ReturnType<typeof useGeoLabel>, selected: string, label: string) {
  if (selected) return `水印地点：${label}（手选，请确认是当前所在楼栋）。`;
  if (geo.state.status === 'locating' || geo.state.status === 'off') return '正在定位，也可以在顶部手选所在楼栋。';
  if (geo.state.status === 'error') return `${geo.state.message}。可以在顶部手选楼栋。`;
  return `水印地点：${label}${geo.location ? `，定位精度约 ±${Math.ceil(geo.location.accuracy)} 米` : ''}${geo.resolution.precision !== 'building' ? '；暂时无法确认具体楼栋，请在顶部手选' : ''}。`;
}

/** 计分打卡的照片要求（与规则页同一份文字） */
function PhotoRules() {
  return (
    <section aria-labelledby="photo-rules" className="rounded-md border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="photo-rules" className="text-[14px] font-semibold text-ink">计分打卡的照片要求</h2>
        <Link to="/rules#photo" className="text-[12.5px] text-ink-3 underline-offset-2 hover:text-ink hover:underline">完整规则</Link>
      </div>
      <ol className="mt-2 space-y-1 text-[13.5px] leading-relaxed text-ink-2">
        {PHOTO_MUST.map((rule, index) => (
          <li key={rule.title} className="flex gap-2"><span className="tabular text-ink-4">{index + 1}</span><span><b className="font-semibold text-ink">{rule.title}</b>：{rule.desc}</span></li>
        ))}
      </ol>
      <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">只拍桌面或风景、翻拍旧图、屏幕上是游戏视频、一个人替两人拍，都会被判为无效。</p>
    </section>
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
