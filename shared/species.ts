// 系统昵称 = 一种南科大校园里常见的动植物 + 编号，例如「白鹭 KLM23」。
// 每位同学默认的形象，就是这种动植物的一幅公版博物画（见 public/assets/species/）。

export interface Species {
  slug: string;
  zh: string;
  latin: string;
  kind: 'plant' | 'bird' | 'animal';
  /** 一句话，出现在主页的图版说明里 */
  note: string;
}

export const SPECIES: Species[] = [
  { slug: 'banyan', zh: '榕树', latin: 'Ficus microcarpa', kind: 'plant', note: '树仁书院里最常见的树，气根垂下来，能长成一片林子。' },
  { slug: 'kapok', zh: '木棉', latin: 'Bombax ceiba', kind: 'plant', note: '早春先开花后长叶，花大而红，落地也是整朵。' },
  { slug: 'lychee', zh: '荔枝', latin: 'Litchi chinensis', kind: 'plant', note: '校园里有成片的荔枝林，五到七月陆续成熟。' },
  { slug: 'flametree', zh: '凤凰木', latin: 'Delonix regia', kind: 'plant', note: '初夏开满红花，毕业季最显眼的树。' },
  { slug: 'bougainvillea', zh: '簕杜鹃', latin: 'Bougainvillea spectabilis', kind: 'plant', note: '深圳市花，颜色鲜艳的其实是苞片。' },
  { slug: 'bauhinia', zh: '紫荆', latin: 'Bauhinia variegata', kind: 'plant', note: '叶子像两片合起来的羊蹄，冬春开花。' },
  { slug: 'frangipani', zh: '鸡蛋花', latin: 'Plumeria rubra', kind: 'plant', note: '花心黄、花瓣白，夏天在路边落一地。' },
  { slug: 'longan', zh: '龙眼', latin: 'Dimocarpus longan', kind: 'plant', note: '和荔枝同科，果期稍晚，夏末成熟。' },
  { slug: 'camphor', zh: '樟树', latin: 'Cinnamomum camphora', kind: 'plant', note: '四季常绿，揉碎叶子有淡淡的樟脑味。' },
  { slug: 'crapemyrtle', zh: '紫薇', latin: 'Lagerstroemia speciosa', kind: 'plant', note: '夏天开满紫色的花，深圳的街边和校园里都很常见。' },
  { slug: 'lotus', zh: '荷花', latin: 'Nelumbo nucifera', kind: 'plant', note: '夏天的水面上最安静的一种花。' },
  { slug: 'magnolia', zh: '白兰', latin: 'Michelia × alba', kind: 'plant', note: '花白而香，岭南人常把它别在衣襟上。' },
  { slug: 'egret', zh: '白鹭', latin: 'Egretta garzetta', kind: 'bird', note: '常在湖边浅水处慢慢踱步觅食。' },
  { slug: 'nightheron', zh: '夜鹭', latin: 'Nycticorax nycticorax', kind: 'bird', note: '白天多在树上休息，傍晚以后才活跃。' },
  { slug: 'kingfisher', zh: '翠鸟', latin: 'Alcedo atthis', kind: 'bird', note: '停在水边的枝头，看准了才一头扎进水里。' },
  { slug: 'bulbul', zh: '红耳鹎', latin: 'Pycnonotus jocosus', kind: 'bird', note: '头顶有黑色的冠羽，叫声清亮，校园里很常见。' },
  { slug: 'whiteeye', zh: '绣眼', latin: 'Zosterops simplex', kind: 'bird', note: '眼圈一圈白，常成群在花间穿梭。' },
  { slug: 'magpierobin', zh: '鹊鸲', latin: 'Copsychus saularis', kind: 'bird', note: '黑白分明，喜欢翘着尾巴在草地上跳。' },
  { slug: 'dove', zh: '斑鸠', latin: 'Spilopelia chinensis', kind: 'bird', note: '颈后一圈珍珠般的斑点，常在草地上低头走路。' },
  { slug: 'bluemagpie', zh: '蓝鹊', latin: 'Urocissa erythroryncha', kind: 'bird', note: '长长的蓝色尾羽，飞起来很好认。' },
  { slug: 'myna', zh: '八哥', latin: 'Acridotheres cristatellus', kind: 'bird', note: '额前一撮羽冠，飞行时翅上有白斑。' },
  { slug: 'sunbird', zh: '太阳鸟', latin: 'Aethopyga christinae', kind: 'bird', note: '个头很小，停在花前吸蜜时翅膀扇得飞快。' },
  { slug: 'wagtail', zh: '鹡鸰', latin: 'Motacilla alba', kind: 'bird', note: '走路时尾巴一上一下地摆个不停。' },
  { slug: 'squirrel', zh: '松鼠', latin: 'Callosciurus erythraeus', kind: 'animal', note: '腹部偏红，常在树枝和电线上跑来跑去。' },
];

const BY_ZH = new Map(SPECIES.map((s) => [s.zh, s]));

/** 昵称「白鹭KLM23」→ 白鹭 */
export function speciesOfNickname(nickname: string): Species | null {
  const m = /^(.*?)([A-Z]{3}\d{2})$/.exec(nickname);
  return BY_ZH.get(m ? m[1] : nickname) ?? null;
}
