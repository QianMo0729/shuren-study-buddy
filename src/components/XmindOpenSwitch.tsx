import { useState } from 'react';
import { Link } from 'react-router';
import { ExternalLink } from 'lucide-react';
import { ConfirmDialog, Skeleton, Toggle } from './ui';
import { benefitsApi, setBenefitsStatus, useBenefitsStatus } from '../lib/benefits';
import { useToast } from '../lib/toast';

/** 管理后台里开放或暂停 Xmind 点数登记的开关。登记默认关闭，上线后由管理员手动开放。 */
export function XmindOpenSwitch() {
  const toast = useToast();
  const { status, error, reload } = useBenefitsStatus();
  const [asking, setAsking] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  if (!status) return error ? <p className="mb-5 text-[13.5px] text-danger">Xmind 登记状态没有加载出来，<button type="button" className="underline" onClick={() => void reload()}>重试</button></p> : <Skeleton className="mb-5 h-[62px] rounded-xl" />;
  const { open, limit, remaining } = status.xmind;
  const registered = limit - remaining;
  async function apply() {
    if (asking === null) return;
    setBusy(true);
    try {
      setBenefitsStatus(await benefitsApi.setXmindOpen(asking));
      toast.success(asking ? 'Xmind 点数登记已开放' : 'Xmind 点数登记已暂停');
      setAsking(null);
    } catch (e) { toast.error('没有改成功', e instanceof Error ? e.message : undefined); } finally { setBusy(false); }
  }
  return <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl bg-surface px-4 py-3.5">
    <div className="min-w-0 flex-1">
      <p className="text-[14px] font-semibold text-ink">Xmind 点数登记</p>
      <p className="mt-0.5 text-[13px] text-ink-3">{open ? '已开放，同学浏览活动页 30 秒后可以登记手机号' : '未开放，同学只能浏览活动内容'} · 已登记 {registered} / {limit}</p>
    </div>
    <Toggle checked={open} onChange={(next) => setAsking(next)} label={open ? '开放中' : '已关闭'} />
    <Link to="/benefits/records" className="inline-flex items-center gap-1.5 text-[13.5px] text-brand-text underline">查看名单 <ExternalLink size={14} /></Link>
    <ConfirmDialog open={asking !== null} loading={busy} onConfirm={apply} onCancel={() => { if (!busy) setAsking(null); }}
      title={asking ? '开放 Xmind 点数登记？' : '暂停 Xmind 点数登记？'} confirmText={asking ? '开放登记' : '暂停登记'}
      desc={asking ? `开放后，登录的同学浏览活动页满 30 秒就可以提交手机号，名额共 ${limit} 份，目前已登记 ${registered} 份。` : `暂停后同学不能再登记，已经打开页面的也一样；已登记的 ${registered} 份不受影响，之后可以再开放。`} />
  </div>;
}
