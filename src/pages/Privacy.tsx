import { Link } from 'react-router';
import { Wordmark, Illustration } from '../components/brand';

export function Privacy() {
  return <main className="mx-auto max-w-3xl px-5 py-8 sm:px-8 sm:py-12">
    <div className="flex items-center justify-between"><Link to="/" aria-label="树仁搭子首页"><Wordmark /></Link><Link to="/me/edit" className="text-sm text-brand-text underline">返回我的资料</Link></div>
    <header className="mt-10 flex items-center gap-6 border-b border-ink pb-6"><div className="flex-1"><h1 className="font-display text-4xl text-ink">隐私政策</h1><p className="mt-3 text-sm leading-relaxed text-ink-2">树仁学发 · 学习搭子匹配系统<br />请在发布主页和交换联系方式前了解你的展示范围。</p></div><Illustration name="mascot-wave" className="hidden size-28 sm:block" /></header>
    <div className="mt-8 space-y-8 text-[15px] leading-8 text-ink-2">
      <section><h2 className="font-display text-2xl text-ink">校园身份与账号</h2><p className="mt-2">系统使用学号对应的校园邮箱验证身份。真实姓名、学号和邮箱不在广场卡片和公开资料中展示；你本人及管理员可以查看这些身份信息。密码仅保存为不可直接还原的哈希，邮箱验证码有有效期且使用一次后失效。</p><p>激活账号、忘记密码以及联系申请、内容撤下提醒，会通过配置的 Resend 邮件服务发送到注册邮箱；邮件服务需要处理收件地址及相应邮件内容。</p></section>
      <section><h2 className="font-display text-2xl text-ink">个人主页与照片</h2><p className="mt-2">发布后，已登录同学可以查看你的昵称、学习目标、时间地点、学习方式和其他主动填写的公开资料。姓名、学号和联系方式不会随这些资料返回。</p><p>照片默认不公开。只有主动选择展示照片并同意隐私说明后，照片才会出现在已登录同学可见的卡片和详情页。未发布、已撤回或被管理员撤下的主页，其照片链接不再向其他同学提供访问；你本人和管理员仍可为修改及审核查看。课程表原图不向其他同学公开。</p></section>
      <section><h2 className="font-display text-2xl text-ink">问卷与搭子推荐</h2><p className="mt-2">系统在本服务内比较已发布问卷中的学习目标、双方可用时间与期望时间、学习方式、地点、节奏和兴趣，计算契合度并给出推荐理由。姓名、学号、邮箱、联系方式、照片、性别、MBTI 和雷区不用于评分；自由文字期待不自动推断。问卷不会为推荐而发送给外部模型服务。</p><p>推荐只包含有共同学习时间、当前愿意寻找搭子的同学。分数用于排序，不代表成功概率，你可以自行检索、选择或拒绝联系。更新并保存问卷后，新一轮推荐会使用最新答案；撤回主页后停止参与推荐。</p></section>
      <section><h2 className="font-display text-2xl text-ink">申请联系与信息交换</h2><p className="mt-2">发起联系申请表示你同意与该同学交换已填写的联系方式，收到申请的一方可以接受或拒绝。在申请被接受前，双方都看不到对方联系方式。只有双方确认后，系统才提供微信、QQ 等已填写内容，以及主动选择交换的校园邮箱。</p><p>校园邮箱包含学号，选择交换邮箱就会向对方暴露学号。公开自我介绍、目标说明及申请留言请避免填入不希望公开的联系方式或其他敏感信息。</p></section>
      <section><h2 className="font-display text-2xl text-ink">排除与撤回</h2><p className="mt-2">排除某位同学后，双方不再出现在彼此的普通检索结果中，也不能继续查看彼此主页及交换联系方式。排除操作不会向对方发送通知；你可以在「我的 → 匹配请求 → 已排除」中取消。</p><p>你可以随时撤回主页或关闭照片分享。系统会停止后续访问，但无法撤回对方此前自行保存的照片或联系方式。</p></section>
      <section><h2 className="font-display text-2xl text-ink">账号注销与审核记录</h2><p className="mt-2">在账号设置中验证密码后可注销账号。注销会退出全部设备，撤回并清除公开主页和招募内容，清理上传图片、联系请求和收藏，并匿名化账号身份。为处理举报和核查管理员操作，系统保留必要的审核记录，这些记录仅管理员可查看。</p><p>管理员可审核内容、处理举报并撤下违规主页或帖子。撤下操作会记录时间、原因和通知发送结果，同时向当事人发送邮件及站内通知。如有相关问题，可联系树仁书院学生发展中心。</p></section>
    </div>
    <p className="mt-10 border-t border-line pt-6 text-sm text-ink-3">发布前的四项隐私确认不会自动勾选。修改分享意愿后请保存，设置会立即应用。</p>
  </main>;
}
