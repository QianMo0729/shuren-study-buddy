import AhoCorasick from 'ahocorasick';

/** Conservative text triage, not an ML confidence score or a safety guarantee. */
export const CONTENT_RISK_ENGINE = 'local-high-risk-rules-v1';
export interface ContentRisk {
  hold: boolean;
  reasons: string[];
  engine: string;
}

// Deliberately exclude profanity, politics, identity terms, ordinary adult topics,
// distress/help-seeking and broad words such as “药”, “枪”, “杀”. A single term
// never triggers a hold: each rule requires multiple nearby, concrete signals.
const groups = {
  childMaterial: ['儿童色情', '幼童色情', '未成年裸照', '未成年人裸照', '未成年性爱视频', 'childporn', 'childsexualabusematerial', 'csam'],
  distribute: ['出售', '售卖', '分享', '交换', '下载链接', '资源链接', '付费观看', '进群领取', '私聊领取', 'forsale', 'selling', 'download', 'trade'],
  drugs: ['海洛因', '冰毒', '可卡因', '甲基苯丙胺', 'heroin', 'cocaine', 'methamphetamine'],
  weapons: ['手枪', '冲锋枪', '炸药', '爆炸物', '雷管', 'handgun', 'explosives'],
  commerce: ['出售', '售卖', '求购', '收购', '购买', '卖', 'forsale', 'selling', 'buying'],
  transaction: ['有货', '现货', '私聊', '加我', '联系我', '包邮', '邮寄', '送货', '价格', '每克', '元一克', 'dmme', 'instock', 'shipping'],
  violence: ['砍死', '捅死', '杀死', '炸死', '开枪打死', 'kill', 'shoot'],
  weaponAction: ['带刀', '持刀', '带枪', '开枪', '炸弹', '汽油', 'withagun', 'withaknife', 'bringagun', 'bringaknife'],
  target: ['你', '他', '她', '同学', '老师', '教授', '学校', '校园', '宿舍', '食堂', '图书馆', 'you', 'him', 'her', 'school', 'campus'],
  imminent: ['今晚', '明天', '今天', '现在', '一会儿', '马上', 'tonight', 'tomorrow', 'today', 'rightnow'],
  doxxing: ['开盒', '人肉', '曝光他的', '曝光她的', '曝光对方', '查户籍', '户籍数据'],
  privateData: ['手机号', '身份证号', '家庭住址', '住址', '户籍地址'],
} as const;
type Group = keyof typeof groups;
const terms = new Map<string, Group[]>();
for (const [group, words] of Object.entries(groups)) {
  for (const word of words) terms.set(word, [...(terms.get(word) ?? []), group as Group]);
}
const matcher = new AhoCorasick([...terms.keys()]);
type Hit = { start: number; end: number; group: Group };

const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[\p{Cf}\s]/gu, '');
// Limit the exemption to a nearby preceding defensive/reporting context, rather
// than exempting a whole post because it happens to contain a benign word.
const contextual = /(?:请勿|切勿|禁止|不要|拒绝|警惕|谨防|抵制|举报|警方查获|警方打击|新闻报道|科普|法律案例|反诈骗|防范|如何识别|提醒大家).{0,20}$/u;
const fictional = /(?:游戏里|游戏中|小说中|小说里|电影中|电影里|台词|剧本).{0,20}$/u;

// Only exempt the attributed quotation itself. Appending “求助” to one's own
// threat, or placing a separate solicitation after a reported quote, is not enough.
function reportedQuotes(sentence: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  for (const quote of sentence.matchAll(/“[^”]{1,180}”|「[^」]{1,180}」|"[^"\n]{1,180}"/gu)) {
    const start = quote.index!;
    const end = start + quote[0].length;
    const before = sentence.slice(Math.max(0, start - 32), start);
    const after = sentence.slice(end, end + 32);
    if (/(?:有人|对方|他|她|陌生人)(?:给我发(?:来|了)?|发给我|对我说|威胁我|发来)(?:消息|信息|私信)?[：:,，]?$/u.test(before)
      && /(?:求助|报警|举报|害怕|怎么办)/u.test(after)) ranges.push({ start, end });
  }
  return ranges;
}

function describesDoxxingVictim(sentence: string, hit: Hit): boolean {
  const before = sentence.slice(Math.max(0, hit.start - 20), hit.start);
  const after = sentence.slice(hit.end + 1, hit.end + 25);
  return /(?:我|我们|本人)(?:刚刚|已经|又|刚)?被(?:人)?(?:恶意)?$/u.test(before)
    || (/(?:有人|对方|他|她)(?:正在|已经|在)?$/u.test(before)
      && /^(?:了)?我(?:的)?(?:手机号|身份证号|家庭住址|住址|户籍地址)/u.test(after));
}

function hitsOf(text: string): Hit[] {
  return matcher.search(text).flatMap(([end, words]) => words.flatMap((word) =>
    (terms.get(word) ?? []).map((group) => ({ start: end - word.length + 1, end, group })),
  ));
}

/** Public free text only. Callers must not pass identity/contact/private fields. */
export function assessContentRisk(input: string): ContentRisk {
  const reasons = new Set<string>();
  // Keep sentence/field boundaries; distant unrelated words must not combine.
  for (const raw of input.slice(0, 50_000).split(/[。！？!?；;\n\r]+/u)) {
    const sentence = normalize(raw);
    if (!sentence) continue;
    const hits = hitsOf(sentence);
    const reports = reportedQuotes(sentence);
    const has = (group: Group, around?: Hit, distance = 32) => hits.some((hit) => hit.group === group
      && (!around || Math.max(hit.start - around.end, around.start - hit.end, 0) <= distance));
    const defensive = (hit: Hit) => {
      const before = sentence.slice(Math.max(0, hit.start - 28), hit.start);
      const after = sentence.slice(hit.end + 1, hit.end + 65);
      // A warning in a previous comma-separated clause must not excuse a new act.
      const clause = before.split(/[，,：:“”"「」]/u).at(-1) ?? '';
      return contextual.test(clause)
        || (/(?:请问)?有人(?:正在|在)?$/u.test(before)
          && /(?:如何|怎么|哪里|怎样)(?:举报|报警)/u.test(after));
    };
    for (const hit of hits) {
      if (reports.some((quote) => hit.start > quote.start && hit.end < quote.end - 1)) continue;
      if (hit.group === 'distribute' && !defensive(hit) && has('childMaterial', hit, 24)) {
        reasons.add('疑似传播或交易涉及未成年人的性剥削材料');
      }
      if (hit.group === 'commerce' && !defensive(hit) && has('transaction', hit, 36)) {
        if (has('drugs', hit, 24)) reasons.add('疑似毒品交易招揽');
        if (has('weapons', hit, 24)) reasons.add('疑似枪支或爆炸物交易招揽');
      }
      if (hit.group === 'violence' && !defensive(hit)
        && !fictional.test(sentence.slice(Math.max(0, hit.start - 80), hit.start))
        && /(?:我(?:们)?(?:今晚|明天|今天|现在|一会儿|马上|已经|准备|打算|决定|要|会|将){1,4}|i(?:will|amgoingto)|we(?:will|aregoingto)).{0,60}$/u.test(sentence.slice(0, hit.start))
        && has('weaponAction', hit, 40) && has('target', hit, 20) && has('imminent', hit, 50)) {
        reasons.add('疑似带有时间、对象和实施手段的严重暴力威胁');
      }
      if (hit.group === 'doxxing' && !defensive(hit) && !describesDoxxingVictim(sentence, hit) && has('privateData', hit, 40)) {
        const nearby = sentence.slice(Math.max(0, hit.start - 40), hit.end + 100);
        if (/(?:1[3-9]\d{9}|\d{17}[\dx]|[\p{Script=Han}]{2,12}(?:路|街|小区)\d{1,4}号)/u.test(nearby)) {
          reasons.add('疑似恶意公开他人的可识别隐私信息');
        }
      }
    }
  }
  return { hold: reasons.size > 0, reasons: [...reasons], engine: CONTENT_RISK_ENGINE };
}
