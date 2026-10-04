/** 正文摘要：合并空白，超过 n 字时截断加省略号 */
export const excerpt = (text: string, n = 24) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > n ? `${flat.slice(0, n)}…` : flat;
};
