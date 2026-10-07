import assert from 'node:assert/strict';
import test from 'node:test';
import { assessContentRisk, CONTENT_RISK_ENGINE } from '../server/contentRisk.ts';

test('ordinary, sensitive, critical and help-seeking speech publishes without review', () => {
  for (const text of [
    '明天图书馆一起学线代，考试加油！', '食堂难吃死了，气得想骂人。',
    '研究毒品成瘾机制，讨论海洛因的危害。', '购买药品请去正规药店。',
    '政治、宗教、性教育课都可以讨论。', '最近很抑郁，有自伤念头，希望找人聊聊。',
    '不要分享未成年裸照，发现后请举报。', '警惕出售海洛因、私聊送货的违法广告。',
    '新闻报道出售炸药并邮寄的案件。', '游戏里我今晚要带刀砍死你，明天打排位。',
    '今天学习反诈骗，警惕开盒曝光手机号13800138000的行为。',
    '我要杀死你', '海洛因', '出售旧书，价格私聊。',
    '这是有人发给我的威胁，我想求助。',
    '今日科普。海洛因危害很大。旧书出售，私聊。',
  ]) assert.equal(assessContentRisk(text).hold, false, text);
});

test('only concrete combined extreme-risk signals enter manual review', () => {
  for (const [text, reason] of [
    ['出售未成年裸照，私聊领取。', '未成年人'],
    ['出售海洛因，有货私聊。', '毒品'],
    ['求购手枪，价格私聊。', '枪支'],
    ['我今晚要带刀去宿舍砍死他。', '暴力威胁'],
    ['开盒曝光他的手机号13800138000，家庭住址在某某路123号。', '隐私'],
    ['cocaine for sale, dm me for shipping', '毒品'],
  ]) {
    const result = assessContentRisk(text);
    assert.equal(result.hold, true, text);
    assert.ok(result.reasons.some((r) => r.includes(reason)), text);
    assert.equal(result.engine, CONTENT_RISK_ENGINE);
  }
});

test('normalization handles common spacing/full-width/zero-width evasion and retains sentence boundaries', () => {
  assert.equal(assessContentRisk('出 售 海\u200b洛因，有货私聊').hold, true);
  assert.equal(assessContentRisk('开盒曝光他的手机号１３８００１３８０００').hold, true);
  assert.equal(assessContentRisk('海洛因危害很大\n出售旧书，有货私聊').hold, false);
  assert.equal(assessContentRisk(`海洛因${'无关内容'.repeat(30)}出售旧书有货私聊`).hold, false);
});

test('reasons are stable and deduplicated without claiming an ML probability', () => {
  const result = assessContentRisk('出售海洛因有货私聊。出售海洛因现货送货。');
  assert.equal(result.reasons.length, 1);
  assert.equal('score' in result, false);
  assert.deepEqual(assessContentRisk(''), { hold: false, reasons: [], engine: CONTENT_RISK_ENGINE });
});

test('victims and attributed reports are not held, while separate malicious actions still are', () => {
  for (const text of [
    '我被开盒了，手机号13800138000被曝光，求助。',
    '有人开盒我的手机号13800138000，怎么办？',
    '我刚刚被恶意人肉，家庭住址被贴在某某路123号，想报警。',
    '有人给我发了“我今晚要带刀去宿舍砍死你”，我很害怕。',
    '对方威胁我：「我今晚要带刀去宿舍砍死你」，怎么办？',
    '请问有人在分享未成年裸照，去哪里举报？',
  ]) assert.equal(assessContentRisk(text).hold, false, text);
  for (const text of [
    '我今晚要带刀去宿舍砍死他，求助。',
    '开盒曝光他的手机号13800138000，求助。',
    '我被开盒了，所以我要开盒曝光他的手机号13800138000。',
    '有人给我发了“我今晚要带刀去宿舍砍死你”，我很害怕，但是我今晚要带刀去宿舍砍死他。',
    '有人给我发了“出售海洛因，有货私聊”，怎么举报，我也出售海洛因有货私聊。',
  ]) assert.equal(assessContentRisk(text).hold, true, text);
});
