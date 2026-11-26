import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Camera, CameraOff, MapPin } from 'lucide-react';
import { FlipIcon, PencilIcon, XIcon } from '../components/icons';
import type { BuddyStatus, Checkin, CheckinStats, CheckinVisibility } from '../../shared/types';
import { api, ApiError, fileUrl } from '../lib/api';
import { ease } from '../lib/motion';
import { useToast } from '../lib/toast';
import { Button, Field, Modal, Segmented, Spinner, Textarea } from '../components/ui';
import { Stamp } from '../components/brand';
import { checkinAlt } from '../components/checkin/CheckinCard';
import { buddyCheckinHint, canTakeScoringCheckin } from '../components/checkin/buddyCheckinHint';
import { useCheckinSession } from '../components/checkin/useCheckinSession';
import { useGeoLabel } from '../components/checkin/useGeoLabel';
import { captureFrame, useLiveCamera } from '../components/checkin/useLiveCamera';
import { Viewfinder } from '../components/checkin/Viewfinder';
import { PHOTO_MUST, captionLength } from '../../shared/activity';
import { useActivityConfig } from '../lib/activity';

const CAPTION_MAX = 200;
const VISIBILITY_OPTIONS = [
  { value: 'all', label: '所有同学' },
  { value: 'buddies', label: '仅私聊的同学' },
];
const VIS_KEY = 'dz-checkin-visibility';

// 只保存个人偏好（默认可见范围）；读写失败时用默认值
const readPref = (key: string) => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const writePref = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch { /* 无痕模式等情况下忽略 */ }
};

/**
 * 实时拍照打卡：只能用网页相机现场拍摄（getUserMedia），页面上没有任何选择文件或相册的入口。
 * 必须定位：地点由定位自动识别，不能手选；定位成功前快门不可用。
 * 快门 → 当前视频帧 → JPEG → 携带一次性拍照凭证与定位提交 → 服务器盖上地点与北京时间后保存。
 */
export function CheckinCamera() {
  const nav = useNavigate();
  const toast = useToast();
  const activity = useActivityConfig();
  const captionId = useId();
  const [done, setDone] = useState<{ checkin: Checkin; stats: CheckinStats } | null>(null);
  const camera = useLiveCamera(!done);
  const live = camera.state.status === 'live';
  const session = useCheckinSession(live && !done);
  // 先让相机完成权限与预览初始化，避免 iPhone 同时弹出相机和定位权限请求。
  const geo = useGeoLabel(live && !done, activity.config.accuracyMeters);
  const watermarkPlace = geo.label;
  const distanceOn = activity.config.distanceMeters > 0;
  const [visibility, setVisibility] = useState<CheckinVisibility>(() => (readPref(VIS_KEY) === 'buddies' ? 'buddies' : 'all'));
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(0);
  const [status, setStatus] = useState('');
  const receiptId = done?.checkin.id ?? null;
  // 回执只用提交成功后取得的状态，避免把快门前的数据当成本次结果。
  const [snapshot, setSnapshot] = useState<{ receiptId: number | null; status: BuddyStatus | null; readAt: number } | null>(null);
  const buddy = snapshot?.receiptId === receiptId ? snapshot.status : undefined;

  useEffect(() => {
    let alive = true;
    let pending = false;
    const refresh = async () => {
      if (document.hidden || pending) return;
      pending = true;
      const readAt = Date.now();
      try {
        const status = await api.activity.me();
        if (alive) setSnapshot({ receiptId, status, readAt });
      } catch {
        if (alive) setSnapshot({ receiptId, status: null, readAt });
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [receiptId]);
  usePageZoomLock();

  useEffect(() => writePref(VIS_KEY, visibility), [visibility]);
  useEffect(() => {
    if (camera.state.status === 'live') setStatus('相机已打开，可以拍照');
    else if (camera.state.status === 'blocked') setStatus('请点击开启相机预览');
    else if (camera.state.status === 'error') setStatus(camera.state.problem.title);
  }, [camera.state]);

  const scoringShot = canTakeScoringCheckin(buddy);
  const hint = buddy && snapshot ? buddyCheckinHint(buddy, activity.config, snapshot.readAt + session.offset, done?.checkin.stampedAt, done?.checkin.id) : null;
  const showCaptionRequirement = hint?.canAddScoringCaption && activity.config.captionMin > 0;
  const captionRemaining = activity.config.captionMin - captionLength(caption);
  const captionShort = captionRemaining > 0;
  const [captionWarned, setCaptionWarned] = useState(false);
  const [locationWarned, setLocationWarned] = useState(false);

  const shoot = async () => {
    const video = camera.videoRef.current;
    const location = geo.location;
    if (busy || !live || !video) return;
    if (!location) {
      toast.info('还没定位到', '打卡需要定位，定位成功后再按快门。');
      return;
    }
    if (scoringShot && captionShort && !captionWarned) {
      setCaptionWarned(true);
      setNoteOpen(true);
      if (showCaptionRequirement) toast.info('写一句学了什么', `搭子计分需至少 ${activity.config.captionMin} 个字。`);
      else toast.info('说明可留空', '点「完成」后再按快门即可打卡。');
      return;
    }
    // 定位误差太大就没法核对两人是否在同一处，这次打卡不计分：先提醒一次
    if (scoringShot && distanceOn && !geo.precise && !locationWarned) {
      setLocationWarned(true);
      toast.info(`定位误差约 ${Math.ceil(location.accuracy)} 米`, `计分要求 ${activity.config.accuracyMeters} 米以内。可等定位改善，或再按快门直接提交。`);
      return;
    }
    // 按下快门的这一刻取帧（裁剪放大时只取画面中间，与取景框一致）
    const image = captureFrame(video, camera.digitalZoom);
    if (!image) {
      toast.error('拍照失败', '画面还没准备好，请稍后再试');
      return;
    }
    setFlash((n) => n + 1);
    setBusy(true);
    setStatus('正在提交，服务器盖章中…');
    try {
      const token = await session.take();
      const r = await api.checkins.create({ token, image, caption: caption.trim(), visibility, location });
      setDone(r);
      if (r.checkin.reviewPending) {
        setStatus('已提交，等待审核，暂未公开');
        toast.info('已提交，等待审核', '内容触发极高风险筛查，审核通过后公开。');
      } else {
        setStatus('打卡照片已提交，服务器已盖章');
        toast.success('打卡照片已提交', r.stats.streak > 1 ? `已连续打卡 ${r.stats.streak} 天` : '服务器已盖上时间和地点');
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
    const resultHint = hint?.text ?? (buddy === null ? '暂时无法读取搭子打卡结果，请稍后在「我的搭子」查看。' : '正在核对搭子打卡结果…');
    const retake = () => {
      setLastPhoto(done.checkin.image);
      setCaptionWarned(false);
      setLocationWarned(false);
      setFlash(0);
      setNoteOpen(buddy?.today?.mine?.issue === 'caption');
      if (snapshot) setSnapshot({ ...snapshot, receiptId: null });
      setDone(null);
    };
    return (
      <div className="fixed inset-0 z-[60] overflow-y-auto bg-paper px-4 pt-[calc(env(safe-area-inset-top)+16px)] pb-[calc(env(safe-area-inset-bottom)+24px)]">
        <p className="sr-only" role="status" aria-live="polite">{status}</p>
        <Result result={done} activityHint={resultHint} onRetake={hint?.canRetake ? retake : undefined} onDone={back} onOpen={() => nav(`/community/checkins/${done.checkin.id}`, { replace: true })} />
      </div>
    );
  }

  const captionHint = captionShort ? `搭子计分还需 ${captionRemaining} 个字。` : '已满足搭子计分字数。';
  return (
    // 全屏黑底相机：顶部关闭与楼栋，中间取景（右下角实时水印），底部快门
    <div className="checkin-camera fixed inset-0 z-[60] flex flex-col overflow-y-auto bg-[#0B0D0C] pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] text-white">
      <p className="sr-only" role="status" aria-live="polite">{status}</p>

      <div className="checkin-camera-header mt-2 flex h-11 shrink-0 items-center justify-between gap-3 px-4">
        <button type="button" onClick={back} aria-label="关闭" className="grid size-11 shrink-0 place-items-center rounded-full bg-white/14">
          <XIcon size={16} width={2.4} />
        </button>
        {/* 地点由定位自动识别，不能手选 */}
        <p className="flex h-9 min-w-0 items-center gap-1.5 rounded-full bg-white/14 px-3.5 text-[15px] font-semibold">
          <MapPin size={15} aria-hidden className="shrink-0" />
          <span className="sr-only">水印上的地点：</span>
          <span className="truncate">{geo.location ? watermarkPlace : geo.state.status === 'error' ? '无法定位' : '正在定位…'}</span>
        </p>
        <button type="button" onClick={() => setNoteOpen(true)} aria-label="说明与可见范围" className="grid size-11 shrink-0 place-items-center rounded-full bg-white/14">
          <PencilIcon size={17} width={2} />
        </button>
      </div>

      <div className="checkin-camera-preview mt-2 flex min-h-24 flex-1 items-center justify-center [container-type:size]">
        {/* 保持视频挂载并参与布局；iPhone 恢复播放时不能从 display:none 状态启动。 */}
        <Viewfinder
          videoRef={camera.videoRef}
          width={camera.state.status === 'live' ? camera.state.width : 0}
          height={camera.state.status === 'live' ? camera.state.height : 0}
          live={live}
          placeLabel={watermarkPlace}
          clockOffset={session.offset}
          zoom={camera.zoom}
          digitalZoom={camera.digitalZoom}
          zoomRange={camera.zoomRange}
          onZoom={camera.setZoom}
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

      <div className="flex shrink-0 flex-col">
        <p className="mt-2 shrink-0 px-4 text-center text-[13px] leading-5 text-white/72">
          {live && !session.ready && !busy && session.error
            ? <span className="text-[#ff8a7a]" role="alert">{session.error}</span>
            : live ? <LocationLine geo={geo} limit={activity.config.accuracyMeters} scoring={scoringShot && distanceOn} />
            : photoGuide}
        </p>
        {hint && (
          <p className={`mx-4 mt-2 max-w-[30em] shrink-0 self-center rounded-2xl px-3.5 py-1.5 text-center text-[13px] leading-5 ${hint.tone === 'good' ? 'bg-[#2f8f6b]/85 text-white' : hint.tone === 'warn' ? 'bg-white/14 text-[#ffcf8a]' : 'bg-white/14 text-white/85'}`}>
            {hint.text}
            {showCaptionRequirement && captionShort && (
              <> · <button type="button" className="text-white underline underline-offset-2" onClick={() => setNoteOpen(true)}>写说明（至少 {activity.config.captionMin} 字）</button></>
            )}
          </p>
        )}

        <div className="my-[clamp(8px,2dvh,20px)] grid shrink-0 grid-cols-3 items-center">
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
              disabled={!live || busy || !geo.location}
              aria-label={geo.location ? '拍照并提交打卡' : '正在定位，定位成功后才能拍照'}
              className="size-[78px] shrink-0 rounded-full border-4 border-white p-1 transition-transform active:scale-95 disabled:opacity-40"
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
      </div>

      <Modal open={noteOpen} onClose={() => setNoteOpen(false)} title="说明与可见范围" size="md">
        <div className="space-y-5 px-5 pt-2 pb-6 text-ink">
          <Field
            label="说明"
            optional
            hint={showCaptionRequirement && captionHint}
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
          <Field label="谁可以看到" hint={visibility === 'all' ? '登录的同学都能看到（与你互相排除的人除外）。' : '只有和你互相感兴趣、正在私聊的同学能看到（绑定的搭子也在其中）。'}>
            <Segmented options={VISIBILITY_OPTIONS} value={visibility} onChange={(v) => setVisibility(v as CheckinVisibility)} />
          </Field>
          {hint?.details && (
            <details className="text-[13px] leading-relaxed text-ink-2">
              <summary className="cursor-pointer font-semibold">搭子打卡详情</summary>
              <p className="mt-1">{hint.details}</p>
            </details>
          )}
          <p className="text-[13px] leading-relaxed text-ink-3">
            {placeHint(geo)}地点由定位自动识别，不能手选。
            经纬度只用来核对距离，不给任何同学看。
          </p>
          <PhotoRules />
          <Button variant="primary" size="lg" className="w-full" onClick={() => setNoteOpen(false)}>完成</Button>
        </div>
      </Modal>
    </div>
  );
}

/**
 * 打卡页不让整个页面被双指缩放：取景框里的双指留给相机变焦。
 * iPhone 的 Safari 不理会 user-scalable=no，要拦下它自己的 gesture 事件。
 */
function usePageZoomLock() {
  useEffect(() => {
    const block = (e: Event) => e.preventDefault();
    const events = ['gesturestart', 'gesturechange', 'gestureend'];
    for (const name of events) document.addEventListener(name, block, { passive: false });
    const root = document.documentElement;
    const previous = root.style.touchAction;
    root.style.touchAction = 'pan-x pan-y';
    return () => {
      for (const name of events) document.removeEventListener(name, block);
      root.style.touchAction = previous;
    };
  }, []);
}

/** 地点说明：定位中、定位结果或失败 */
function placeHint(geo: ReturnType<typeof useGeoLabel>) {
  if (geo.location) {
    const coarse = geo.resolution.precision === 'campus' ? '（暂时认不出具体楼栋）' : '';
    return `水印地点：${geo.label}${coarse}，定位误差约 ±${Math.ceil(geo.location.accuracy)} 米。`;
  }
  if (geo.state.status === 'error') return `${geo.state.message}。`;
  return '正在定位。';
}

const photoGuide = <>手或手臂和学习内容同框 · <Link to="/rules#photo" className="text-white underline underline-offset-2">照片要求</Link></>;

/**
 * 取景框下方的一行：定位状态优先（没定位不能拍），定位正常时显示拍摄要求。
 * 定位误差太大时，计分打卡会提醒这次可能不计分。
 */
function LocationLine({ geo, limit, scoring }: { geo: ReturnType<typeof useGeoLabel>; limit: number; scoring: boolean }) {
  const [helpOpen, setHelpOpen] = useState(false);
  if (geo.state.status === 'error' && !geo.location) {
    return (
      <>
        <span role="alert" className="text-[#ffcf8a]">{geo.state.denied ? '请允许定位' : geo.state.message}</span>
        {geo.state.denied && (
          <>
            {' · '}<button type="button" onClick={() => setHelpOpen(true)} className="text-white underline underline-offset-2">开启方法</button>
            <Modal open={helpOpen} onClose={() => setHelpOpen(false)} title="如何允许定位" size="sm">
              <div className="space-y-2 px-5 pt-2 pb-5 text-[14px] leading-relaxed text-ink">
                <p>iPhone 在「设置 → 隐私与安全性 → 定位服务」中选择当前浏览器，允许使用期间定位，并打开「精确位置」。使用 Safari 时选择「Safari 网站」。</p>
                <p>安卓在浏览器的网站设置中允许本站访问位置信息，并确认系统已给浏览器定位权限。</p>
              </div>
            </Modal>
          </>
        )}
        {' · '}<button type="button" onClick={geo.retry} className="text-white underline underline-offset-2">重新定位</button>
      </>
    );
  }
  if (!geo.location) return <span className="inline-flex items-center gap-1.5"><Spinner className="text-white/72" />定位后即可拍照</span>;
  if (!geo.precise) {
    const accuracy = Math.ceil(geo.location.accuracy);
    const tip = accuracy > 1000 ? '请开启精确位置' : '靠窗定位更准';
    return <span className="text-[#ffcf8a]">误差约 {accuracy} 米 · {scoring ? `超过 ${limit} 米不计分` : tip}</span>;
  }
  return photoGuide;
}

/** 计分打卡的照片要求（与规则页同一份文字） */
function PhotoRules() {
  return (
    <details className="text-[14px] text-ink">
      <summary className="cursor-pointer font-semibold">拍摄要求</summary>
      <ol className="mt-2 space-y-1 text-[13.5px] leading-relaxed text-ink-2">
        {PHOTO_MUST.map((rule, index) => (
          <li key={rule.title} className="flex gap-2"><span className="tabular text-ink-4">{index + 1}</span><span><b className="font-semibold text-ink">{rule.title}</b>：{rule.desc}</span></li>
        ))}
      </ol>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-3">
        请用相机现场拍摄。提交后，照片会盖上拍摄地点和北京时间。{' '}
        <Link to="/rules#photo" className="underline underline-offset-2">完整规则</Link>
      </p>
    </details>
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

function Result({ result, activityHint, onDone, onOpen, onRetake }: {
  result: { checkin: Checkin; stats: CheckinStats };
  activityHint: string;
  onDone: () => void;
  onOpen: () => void;
  onRetake?: () => void;
}) {
  const { checkin, stats } = result;
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease }} className="mx-auto max-w-[720px]">
      <div className="mb-3 rounded-md border border-line bg-surface p-4 sm:p-5">
        <h1 className="font-display text-[22px] text-ink">{checkin.reviewPending ? '已提交，等待审核' : '打卡照片已提交'}</h1>
        <p className="mt-1 text-[14px] leading-relaxed text-ink-2" role="status">{activityHint}</p>
        {onRetake && <Button size="sm" variant="secondary" className="mt-2" onClick={onRetake}>重新拍照</Button>}
        {checkin.reviewPending && <p className="mt-2 text-[14px] text-ink-2">暂未公开：{checkin.reviewReasons.join('；')}。审核通过后显示。</p>}
      </div>
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
        <dl className="grid gap-x-6 gap-y-2 text-[14px] sm:grid-cols-2">
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
            <dd className="text-ink">{checkin.reviewPending ? '等待审核，暂未公开' : checkin.visibility === 'buddies' ? '仅私聊的同学' : '所有同学'}</dd>
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
