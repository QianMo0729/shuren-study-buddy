import { useEffect, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import {
  BONUS_RULES, INVALID_REASONS, PHOTO_INVALID, PHOTO_MUST, SENSITIVE_LABELS, BLOCKED_CATEGORIES, SHUREN_ID_RULE_TEXT, addDays, mondayOf, shortDate, weekdayLabel,
} from '../../shared/activity';
import { TAKEDOWN_REASONS } from '../../shared/options';
import { Wordmark } from '../components/brand';
import { useActivityConfig } from '../lib/activity';

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20">
      <h2 className="font-display text-2xl text-ink">{title}</h2>
      <div className="mt-2 space-y-3">{children}</div>
    </section>
  );
}

/** 搭子打卡活动规则：数字取自后台设置，与积分计算使用同一份参数 */
export function Rules() {
  const { config: c } = useActivityConfig();
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);
  const blocked = BLOCKED_CATEGORIES.map((k) => SENSITIVE_LABELS[k]).join('、');
  const warned = (Object.keys(SENSITIVE_LABELS) as (keyof typeof SENSITIVE_LABELS)[]).filter((k) => !BLOCKED_CATEGORIES.includes(k)).map((k) => SENSITIVE_LABELS[k]).join('、');

  return (
    <main className="mx-auto max-w-3xl px-5 py-8 sm:px-8 sm:py-12">
      <div className="flex items-center justify-between">
        <Link to="/" aria-label="树仁搭子首页"><Wordmark /></Link>
        <Link to="/buddy" className="text-sm text-brand-text underline">我的积分与名次</Link>
      </div>
      <header className="mt-10 border-b border-ink pb-6">
        <h1 className="font-display text-4xl text-ink">搭子打卡活动规则</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-2">
          本赛季 {shortDate(c.seasonStart)}（{weekdayLabel(c.seasonStart)}）至 {shortDate(c.seasonEnd)}（{weekdayLabel(c.seasonEnd)}），从 {shortDate(c.seasonStart)} 起的打卡才计分。奖励只发给搭子组合，不单独发给个人。
          <br />本页的数字与系统计分使用同一份设置，调整时会同步更新。
        </p>
        <nav aria-label="目录" className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[13.5px] text-ink-3">
          {[['join', '参加条件'], ['bind', '绑定与解绑'], ['score', '计分'], ['photo', '照片要求'], ['audit', '抽检与防作弊'], ['bonus', 'Bonus'], ['board', '积分、名次与并列'], ['conduct', '社区与私聊规范']].map(([id, label]) => (
            <a key={id} href={`#${id}`} className="underline-offset-2 hover:text-ink hover:underline">{label}</a>
          ))}
        </nav>
      </header>

      <div className="mt-8 space-y-10 text-[15px] leading-8 text-ink-2">
        <Section id="join" title="参加条件">
          <p>用校园邮箱激活账号、完成问卷并发布主页后，和一位同学绑定为学习搭子即可参加。</p>
          <p>组合中<b className="text-ink">至少一方是树仁书院学生</b>，才能参与排名和评奖；两人都不是树仁学生的组合可以照常打卡、累计积分，但不排名。书院身份由系统按学号判断：学号前六位是 {SHUREN_ID_RULE_TEXT}的是树仁书院学生，其他学号暂时按非树仁学生处理，不需要自己填写。在「我的搭子」页最下面可以看到自己的判断结果。</p>
        </Section>

        <Section id="bind" title="绑定、解绑与重新绑定">
          <ul className="list-disc space-y-1 pl-5">
            <li>一对一绑定，每人同时只能有一个搭子。在私聊或对方主页上发出邀请，对方接受后生效；已经认识的同学可以在「找同学」里输入对方的 ID 找到对方。</li>
            <li>同时最多向 3 位同学发出邀请；接受其中一个后，双方其他待处理的邀请自动作废。</li>
            <li>绑定后从<b className="text-ink">下一个周一</b>开始计分；赛季开始前绑定的，从赛季第一天开始计分。</li>
            <li>任何一方都可以随时解绑，立即生效，对方会收到通知。<b className="text-ink">解绑后两人的搭子积分都清零</b>，组合退出排名。解除私聊配对、排除对方或注销账号，也会同时解绑。</li>
            <li>解绑后可以和任何人（包括原来的搭子）重新绑定。新的绑定从 0 分算起，按新的绑定日期重新算从哪天开始计分（赛季中重新绑定的，从下一个周一开始），原来的积分不会恢复。</li>
          </ul>
        </Section>

        <Section id="score" title="相同事件打卡与计分">
          <ul className="list-disc space-y-1 pl-5">
            <li>只按打卡次数计分，必须两人都打卡才给分。</li>
            <li><b className="text-ink">每人每天只有第一次打卡参与计分</b>（北京时间）。当天之后的打卡照常发到社区，但不计分；第一次打卡删掉后重拍也不能换一次。</li>
            <li>同一天两人的计分打卡都有效、时间相差不超过 <b className="text-ink">{c.windowMinutes} 分钟</b>{c.distanceMeters > 0 && <>、两人打卡的位置相距不超过 <b className="text-ink">{c.distanceMeters} 米</b></>}，算一次相同事件打卡。跨天不算，例如 23:50 和次日 00:10。先约好时间和地方再拍。</li>
            <li id="location">
              <b className="text-ink">打卡必须定位，地点不能手选。</b>照片上的地点按定位自动识别
              {c.distanceMeters > 0 && <>，两人的距离也按定位算；定位误差超过 {c.accuracyMeters} 米的打卡不计分（拍照页会提醒）</>}。
              iPhone 要在「设置 → 隐私与安全性 → 定位服务 → Safari 网站」里选「使用 App 期间」并打开「精确位置」。
            </li>
            <li>每天最多算 1 次，每周最多计 <b className="text-ink">{c.weeklyCap} 次</b>。</li>
            <li>有效打卡：网页相机现场拍摄（不能从相册上传），照片符合下面的要求，并在说明里写一句学了什么（至少 {c.captionMin} 个字）。</li>
            <li>每周日 24:00 截止，周一按下表把上一周的次数换算成分数，直接累加到组合总积分。取消补卡，缺卡不能补。</li>
            {mondayOf(c.seasonStart) !== c.seasonStart && (
              <li>第一周不满一周：从 {shortDate(c.seasonStart)}（{weekdayLabel(c.seasonStart)}）算到 {shortDate(addDays(mondayOf(c.seasonStart), 6))}（周日），按同一张表换算；{shortDate(c.seasonStart)} 之前的打卡不计分。</li>
            )}
          </ul>
          <table className="w-full max-w-sm border-collapse text-[14px]">
            <thead><tr className="border-b border-ink text-left"><th className="py-1.5 font-semibold text-ink">当周次数</th><th className="py-1.5 font-semibold text-ink">当周得分</th></tr></thead>
            <tbody>
              {c.ladder.map((points, count) => (
                <tr key={count} className="border-b border-line"><td className="py-1.5 tabular">{count === c.weeklyCap && count < 7 ? `${count} 次及以上` : `${count} 次`}</td><td className="py-1.5 tabular">{points} 分</td></tr>
              ))}
            </tbody>
          </table>
          <p>积分只按组合计算，没有个人积分。例如两人第 1 周 1 次（1 分）、第 2 周 2 次（3 分）、第 3 周 3 次（4 分）、第 4 周 4 次（6 分），组合总积分 1+3+4+6=14 分。</p>
        </Section>

        <Section id="photo" title="打卡照片要求">
          <p>以下三条都要满足：</p>
          <ol className="list-decimal space-y-1 pl-5">
            {PHOTO_MUST.map((rule) => <li key={rule.title}><b className="text-ink">{rule.title}</b>：{rule.desc}</li>)}
          </ol>
          <p>以下情况不算有效：</p>
          <ul className="list-disc space-y-1 pl-5">{PHOTO_INVALID.map((rule) => <li key={rule}>{rule}</li>)}</ul>
          <p>{c.distanceMeters > 0 ? `不要求两人同框，各自拍自己的学习画面即可；但两人要在 ${c.distanceMeters} 米以内（例如同一栋楼、相邻的教室或自习室），线上一起学习不算。` : '线上一起学习的，各自拍自己的学习画面即可，不要求两人同框。'}</p>
        </Section>

        <Section id="audit" title="抽检、防作弊与判无效">
          <ul className="list-disc space-y-1 pl-5">
            <li><b className="text-ink">打卡要用自己的手机。</b>同一台设备（同一个浏览器）一天只能给一个账号打卡，第二个账号会被拒绝。</li>
            <li>每周一从上一周的计分打卡中随机抽取约 {c.auditRate}% 复核；另外，系统会把可疑的打卡全部加入复核：两人的打卡来自同一台设备、两人几乎同时提交、两人的账号曾在同一台设备上登录、两人的照片几乎一样（像是同一部手机在同一个位置拍的）。这些只是提示，由审核员对比两人的照片判断，不会自动判无效。</li>
            <li>评奖前，获奖名次内（前 {c.prizePairs} 组，含名次边界上的并列）的组合，所有计分打卡全部复核。</li>
            <li>判无效只能使用以下理由：{INVALID_REASONS.join('；')}；其他情况需写明具体原因。判无效的打卡照常显示，只是不计分。</li>
            <li>判无效后，本人会收到站内通知和邮件，<b className="text-ink">{c.appealHours} 小时内可以申诉一次</b>，由另一位审核员复核（原来判无效的人不能处理），复核结果为最终结果。</li>
            <li>一个组合在绑定期间累计 {c.strikeLimit} 次无效打卡，取消本赛季评奖资格。经核实代打卡、一人操作两个账号等作弊行为的，两人都取消本赛季评奖资格，换搭子也不能恢复。平台的其他功能可以照常使用。</li>
          </ul>
        </Section>

        <Section id="bonus" title="Bonus：学习分享">
          <p>已绑定搭子的同学在社区发帖时打开「申请 Bonus」，帖子会带上「学习分享」标签，出现在社区的「学习分享」分区，由审核员审核。</p>
          <ul className="list-disc space-y-1 pl-5">{BONUS_RULES.map((rule) => <li key={rule}>{rule}</li>)}</ul>
          <p>每个组合每周最多申请 {c.bonusWeeklyMax} 次，通过一次加 {c.bonusPoints} 分，整个赛季最多加 {c.bonusSeasonMax} 分。分数计入申请所在的那一周，周一随打卡分一起更新。通过后的帖子不能再修改；未通过的会说明原因。</p>
        </Section>

        <Section id="board" title="积分、名次与并列">
          <p>所有组合按总积分排名（搭子总榜）。<b className="text-ink">每个组合只能看到自己的总积分和名次</b>，看不到别的组合，在「今天」「我的搭子」和「我的」里都能看到。总积分和名次只统计已经结束的周，每周一更新；本周的次数和结算后能加的分数也会实时显示。</p>
          <p>总分相同时，依次比较：</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>不含 Bonus 的打卡分，高者在前；</li>
            <li>满勤周数（当周达到 {c.weeklyCap} 次），多者在前；</li>
            <li>计入的相同事件打卡总次数，多者在前；</li>
            <li>达到最终分数的时间，早者在前。</li>
          </ol>
          <p>以上全部相同的为并列，名次相同。并列刚好跨过奖项名额边界时，由学发公开抽签（全程录屏）决定。</p>
        </Section>

        <Section id="conduct" title="社区与私聊规范">
          <p>主页、帖子、评论和打卡出现以下情况会被撤下，本人会收到站内通知和写明时间与原因的邮件：{TAKEDOWN_REASONS.join('；')}。</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>第 1 次：撤下内容并说明原因。</li>
            <li>30 天内第 2 次：撤下，并再次提醒。</li>
            <li>30 天内第 3 次，或骚扰他人、色情、泄露他人隐私、政治敏感等情节严重的：撤下，并取消本赛季评奖资格；必要时转交书院处理。</li>
          </ul>
          <p>私聊中涉及{blocked}的内容不能发送；涉及{warned}的内容发送前会提醒，对方收到时也会看到提示，可以直接举报。举报私聊时，会把被举报消息前后各 20 条对话一起提交，只有管理员能看到。</p>
        </Section>
      </div>
      <p className="mt-10 border-t border-line pt-6 text-sm text-ink-3">
        有疑问可以联系树仁书院学生发展中心。个人信息的处理方式见<Link to="/privacy" className="ml-1 text-brand-text underline">隐私政策</Link>。
      </p>
    </main>
  );
}
