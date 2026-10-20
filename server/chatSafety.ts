// 私聊敏感词：政治敏感直接拦截；色情、血腥、暴力在发送前提醒，对方收到时显示提示。
// 词库存在 settings 表里，审核人员可以在后台修改；没有修改过时使用下面的默认词库。
// 匹配前统一全半角、大小写，并去掉空白与常见分隔符，「约 炮」「约*炮」也能识别。
import AhoCorasick from 'ahocorasick';
import { BLOCKED_CATEGORIES, SENSITIVE_CATEGORIES, type SensitiveCategory } from '../shared/activity.ts';
import { HttpError } from './auth.ts';
import { getSetting, setSetting } from './db.ts';

export type WordLists = Record<SensitiveCategory, string[]>;

/** 默认词库刻意保守：只收具体、明确的说法，避免误伤「考研政治」「思政课」等正常学习内容 */
export const DEFAULT_WORDS: WordLists = {
  politics: ['法轮功', '法轮大法', '台独', '港独', '藏独', '疆独', '东突', '颠覆国家政权', '分裂国家', '推翻共产党', '推翻中共', '全能神'],
  porn: ['约炮', '裸聊', '一夜情', '援交', '黄片', '色情网站', '成人视频', '性交易', '卖淫', '嫖娼', '包夜', '口交', '做爱', '自慰', '裸照'],
  gore: ['碎尸', '分尸', '肢解', '斩首', '血腥视频', '虐杀', '剥皮', '挖眼', '断肢'],
  violence: ['弄死你', '杀了你', '砍死你', '捅死你', '打死你', '揍死你', '宰了你', '找人打你', '废了你', '杀你全家'],
};

const KEY = 'chat_sensitive_words';
export const WORD_MAX = 30;
export const WORDS_PER_CATEGORY = 500;

/** 全半角、大小写统一，去掉空白、零宽字符与常见分隔符 */
export function normalizeForMatch(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[\s\p{Cf}*·.,，。、_\-—|/\\~!！?？'"“”‘’`^+=#@&%$()（）[\]【】{}<>《》:：;；]+/gu, '');
}

export function wordLists(): WordLists {
  const raw = getSetting(KEY, '');
  if (!raw) return DEFAULT_WORDS;
  try {
    const parsed = JSON.parse(raw);
    return Object.fromEntries(SENSITIVE_CATEGORIES.map((c) => [c, Array.isArray(parsed?.[c]) ? parsed[c].filter((w: unknown) => typeof w === 'string') : DEFAULT_WORDS[c]])) as WordLists;
  } catch {
    return DEFAULT_WORDS;
  }
}

export function saveWordLists(input: unknown): WordLists {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out = {} as WordLists;
  for (const category of SENSITIVE_CATEGORIES) {
    const raw = src[category];
    const list = (Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\n,，、]+/) : [])
      .map((w) => (typeof w === 'string' ? w.trim() : ''))
      .filter(Boolean);
    if (list.some((w) => [...w].length > WORD_MAX)) throw new HttpError(400, `每个词最多 ${WORD_MAX} 个字`);
    const unique = [...new Set(list)];
    if (unique.length > WORDS_PER_CATEGORY) throw new HttpError(400, `每一类最多 ${WORDS_PER_CATEGORY} 个词`);
    if (unique.some((w) => !normalizeForMatch(w))) throw new HttpError(400, '词里至少要有一个文字');
    out[category] = unique;
  }
  setSetting(KEY, JSON.stringify(out));
  return out;
}

let compiled: { raw: string; matcher: AhoCorasick | null; categories: Map<string, SensitiveCategory[]> } | null = null;

function matcher() {
  const raw = getSetting(KEY, '');
  if (compiled && compiled.raw === raw) return compiled;
  const categories = new Map<string, SensitiveCategory[]>();
  const lists = wordLists();
  for (const category of SENSITIVE_CATEGORIES) {
    for (const word of lists[category]) {
      const key = normalizeForMatch(word);
      if (key) categories.set(key, [...new Set([...(categories.get(key) ?? []), category])]);
    }
  }
  compiled = { raw, matcher: categories.size ? new AhoCorasick([...categories.keys()]) : null, categories };
  return compiled;
}

/** 检查一条私聊消息命中的类别 */
export function checkMessage(body: string): { blocked: SensitiveCategory[]; warned: SensitiveCategory[] } {
  const { matcher: m, categories } = matcher();
  if (!m) return { blocked: [], warned: [] };
  const hits = new Set<SensitiveCategory>();
  for (const [, words] of m.search(normalizeForMatch(body))) for (const word of words) for (const c of categories.get(word) ?? []) hits.add(c);
  const found = SENSITIVE_CATEGORIES.filter((c) => hits.has(c));
  return { blocked: found.filter((c) => BLOCKED_CATEGORIES.includes(c)), warned: found.filter((c) => !BLOCKED_CATEGORIES.includes(c)) };
}
