import { Link } from 'react-router';
import { Wordmark, Illustration } from '../components/brand';

export function Privacy() {
  return <main className="mx-auto max-w-3xl px-5 py-8 sm:px-8 sm:py-12">
    <div className="flex items-center justify-between"><Link to="/" aria-label="树仁搭子首页"><Wordmark /></Link><Link to="/me/edit" className="text-sm text-brand-text underline">返回我的资料</Link></div>
    <header className="mt-10 flex items-center gap-6 border-b border-ink pb-6"><div className="flex-1"><h1 className="font-display text-4xl text-ink">隐私政策</h1><p className="mt-3 text-sm leading-relaxed text-ink-2">树仁学发 · 学习搭子匹配系统<br />请在发布主页和交换联系方式前了解你的展示范围。</p></div><Illustration name="mascot-wave" className="hidden size-28 sm:block" /></header>
    <div className="mt-8 space-y-8 text-[15px] leading-8 text-ink-2">
      <section><h2 className="font-display text-2xl text-ink">校园身份与账号</h2><p className="mt-2">系统使用学号对应的校园邮箱验证身份。真实姓名、学号和邮箱不在广场卡片和公开资料中展示；你本人及管理员可以查看这些身份信息。密码仅保存为不可直接还原的哈希，邮箱验证码有有效期且使用一次后失效。</p><p>激活账号、忘记密码、互相感兴趣提醒、交换联系方式申请以及内容撤下提醒，会通过配置的 Resend 邮件服务发送到注册邮箱；邮件中只包含对方的系统昵称和站内链接，邮件服务需要处理收件地址及相应邮件内容。</p></section>
      <section><h2 className="font-display text-2xl text-ink">个人主页与照片</h2><p className="mt-2">发布后，已登录同学可以查看你的昵称、学习目标、时间地点、学习方式和其他主动填写的公开资料。姓名、学号和联系方式不会随这些资料返回。</p><p>照片默认不公开。只有主动选择展示照片并同意隐私说明后，照片才会出现在已登录同学可见的卡片和详情页。未发布、已撤回或被管理员撤下的主页，其照片链接不再向其他同学提供访问；你本人和管理员仍可为修改及审核查看。课程表原图不向其他同学公开。</p></section>
      <section><h2 className="font-display text-2xl text-ink">问卷与搭子推荐</h2><p className="mt-2">系统在本服务内比较已发布问卷中的共同时间、学习目标与具体科目、学习性格小题、学习方式、地点、学习节奏和兴趣，计算双方的契合度并给出推荐理由。契合度同时考虑「对方是否符合你的期待」与「你是否符合对方的期待」。MBTI 若双方都填写，会以较小权重计入学习性格。性别只在你或对方设置了「希望搭子性别」时作为双向筛选条件使用，不参与打分。姓名、学号、邮箱、联系方式和照片不用于推荐；自由文字期待不会被自动推断。问卷不会为推荐而发送给外部模型服务。</p><p>推荐只包含双方硬性条件都满足、有共同学习时间、当前愿意寻找搭子的同学。分数用于排序，不代表成功概率。更新并保存问卷后，下一次推荐会使用最新答案；撤回主页后停止参与推荐。</p></section>
      <section><h2 className="font-display text-2xl text-ink">个性化排序</h2><p className="mt-2">你在匹配推荐中选择「感兴趣」「不感兴趣」或「稍后再看」时，系统会保存这次选择以及当时双方问卷的比较结果（例如共同时间、学习内容、学习性格的契合程度），用来在本服务内训练只属于你账号的偏好模型，使排序更接近你的选择。全站所有选择的比较结果会汇总成默认排序权重，不包含可识别个人的信息。模型不使用性别、照片、年级或昵称。</p><p>其他同学看不到你的选择；选择「不感兴趣」后，对方不会再出现在你的推荐中，也不会收到任何提示。你可以在「我的 → 推荐偏好」中把同学放回推荐。</p></section>
      <section><h2 className="font-display text-2xl text-ink">私聊与信息交换</h2><p className="mt-2">只有双方都选择「感兴趣」后，才能在站内私聊。聊天内容保存在本服务中，仅聊天双方可见；只有当某条消息被举报时，管理员才会看到这条被举报消息的内容，用于核实处理。任一方可以随时解除配对，聊天随即关闭。</p><p>在私聊中可以申请交换联系方式，对方同意后，双方才能看到彼此填写的微信、QQ 等联系方式，以及主动选择交换的校园邮箱。校园邮箱包含学号，选择交换邮箱就会向对方暴露学号。公开自我介绍、帖子和聊天中请避免填入不希望公开的敏感信息。</p></section>
      <section><h2 className="font-display text-2xl text-ink">校园社区与学习打卡</h2><p className="mt-2">聊天区的帖子、图片、评论和点赞对已登录同学可见（互相排除的同学除外），帖子只显示系统昵称。你可以删除自己的帖子和评论。</p><p>打卡照片只能通过网页实时拍照获得，不能上传相册图片。服务器收到照片后，在照片右下角盖上地点与北京时间水印，并去除照片自带的拍摄信息。若你允许浏览器定位，位置只用于换算成校园地点名称（例如「南科大·琳恩图书馆」），系统不保存经纬度；不允许定位也可以打卡，水印显示「未提供位置」。打卡可以选择所有同学可见，或仅互相感兴趣的搭子可见。</p></section>
      <section><h2 className="font-display text-2xl text-ink">排除与撤回</h2><p className="mt-2">排除某位同学后，双方不再出现在彼此的推荐、检索、社区和私聊中，已有配对会被解除，也不能继续交换联系方式。排除操作不会向对方发送通知；你可以在「我的 → 推荐偏好 → 已排除」中取消。</p><p>你可以随时撤回主页或关闭照片分享。系统会停止后续访问，但无法撤回对方此前自行保存的照片或联系方式。</p></section>
      <section><h2 className="font-display text-2xl text-ink">账号注销与审核记录</h2><p className="mt-2">在账号设置中验证密码后可注销账号。注销会退出全部设备，撤回并清除公开主页、招募、社区帖子、评论和打卡，清理上传图片、推荐选择记录、私聊配对与消息、联系请求和收藏，并匿名化账号身份。为处理举报和核查管理员操作，系统保留必要的审核记录，这些记录仅管理员可查看。</p><p>管理员可审核内容、处理举报并撤下违规主页、帖子、评论或打卡。撤下操作会记录时间、原因和通知发送结果，同时向当事人发送邮件及站内通知。如有相关问题，可联系树仁书院学生发展中心。</p></section>
    </div>
    <p className="mt-10 border-t border-line pt-6 text-sm text-ink-3">发布前的四项隐私确认不会自动勾选。修改分享意愿后请保存，设置会立即应用。</p>
  </main>;
}
