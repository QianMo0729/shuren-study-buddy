import { useEffect, useState, type FormEvent } from 'react';
import { Download, LockKeyhole, RefreshCw } from 'lucide-react';
import { Button, ConfirmDialog } from '../components/ui';
import { useAuth } from '../lib/auth';
import { benefitsApi, fetchXmindRecords, refreshBenefitsStatus, type XmindRecord } from '../lib/benefits';
import { BenefitsLayout } from './Benefits';

export function BenefitRecords() {
  const { user } = useAuth();
  const [input, setInput] = useState('');
  const [credential, setCredential] = useState<string | null>(null);
  const [items, setItems] = useState<XmindRecord[]>([]);
  const [updated, setUpdated] = useState('');
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [exporting, setExporting] = useState(false);
  // 更正或删除登记只有网站管理员能做；持口令的合作方人员只能查看和导出
  const isAdmin = user?.role === 'admin';
  const [removing, setRemoving] = useState<XmindRecord | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const authorized = user?.role === 'admin' || credential !== null;
  useEffect(() => {
    setItems([]); setUpdated(''); setError('');
    if (!authorized) return;
    let active = true;
    let loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const response = await fetchXmindRecords(credential ?? '');
        const data: { items: XmindRecord[] } = await response.json();
        if (active) { setItems(data.items); setUpdated(new Date().toLocaleTimeString('zh-CN')); setError(''); }
      } catch (e) { if (active) { setItems([]); setUpdated(''); setError(e instanceof Error ? e.message : '网络连接失败'); } }
      finally { loading = false; }
    };
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [authorized, credential, refresh, user?.id]);
  function connect(e: FormEvent) { e.preventDefault(); setCredential(input.trim()); setInput(''); setRefresh((n) => n + 1); }
  async function download() {
    setExporting(true);
    try {
      const response = await fetchXmindRecords(credential ?? '', true);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = 'xmind-registrations.csv'; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(e instanceof Error ? e.message : '导出失败'); }
    finally { setExporting(false); }
  }
  async function remove() {
    if (!removing) return;
    setRemoveBusy(true);
    try {
      await benefitsApi.removeRecord(removing.id);
      setItems((list) => list.filter((item) => item.id !== removing.id));
      setRemoving(null); setError('');
      void refreshBenefitsStatus();
    } catch (e) { setRemoving(null); setError(e instanceof Error ? e.message : '删除失败'); setRefresh((n) => n + 1); }
    finally { setRemoveBusy(false); }
  }
  return <BenefitsLayout><section className="benefits-records">
    <p className="benefits-eyebrow">仅供活动负责人员使用</p><h1>Xmind 点数领取名单</h1>
    <p>仅用于本次点数发放，请勿公开或转发完整名单。实时查看名单不代表实时充值。</p>
    {user?.role !== 'admin' && <form className="benefits-records-login" onSubmit={connect}>
      <label htmlFor="list-token"><LockKeyhole size={17} /> 名单访问口令</label><input id="list-token" type="password" autoComplete="off" required value={input} onChange={(e) => setInput(e.target.value)} placeholder="请输入活动方提供的访问口令" /><Button type="submit" variant="primary">查看名单</Button>
    </form>}
    {error && <p className="benefits-error" role="alert">{error}</p>}
    {authorized && <><div className="benefits-records-toolbar"><div><strong>{updated ? `${items.length} / 200 条登记` : '等待连接'}</strong><p aria-live="polite">{updated ? `每 5 秒自动刷新 · 上次成功更新 ${updated}` : '暂无成功读取的数据'}</p></div><div className="benefits-actions"><Button onClick={() => setRefresh((n) => n + 1)} icon={<RefreshCw size={15} />}>刷新</Button><Button onClick={download} loading={exporting} disabled={!updated} icon={<Download size={15} />}>导出 CSV</Button>{credential !== null && <Button onClick={() => { setCredential(null); setItems([]); setUpdated(''); }}>退出查看</Button>}</div></div>
      <div className="benefits-table-scroll"><table className="benefits-table"><thead><tr><th>序号</th><th>Xmind 账号绑定手机号</th><th>提交时间（北京时间）</th>{isAdmin && <th>更正</th>}</tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{item.id}</td><td>{item.phone}</td><td>{new Date(item.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</td>{isAdmin && <td><button type="button" className="benefits-table-remove" onClick={() => setRemoving(item)}>删除</button></td>}</tr>)}</tbody></table>{updated && !items.length && <p className="benefits-footnote">暂无领取登记，新提交会自动出现在这里。</p>}</div></>}
    <ConfirmDialog open={!!removing} tone="danger" title="删除这条登记？" confirmText="删除" loading={removeBusy} onConfirm={remove} onCancel={() => { if (!removeBusy) setRemoving(null); }}
      desc={<>手机号 {removing?.phone} 的登记会被删除并空出一个名额，这位同学可以重新登记正确的号码。已经导出给 Xmind 的名单不会跟着改，需要另行告知。</>} />
  </section></BenefitsLayout>;
}
