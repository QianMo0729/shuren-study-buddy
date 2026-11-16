import fs from 'node:fs';
import { importMarginNoteCodes } from '../server/benefits.ts';
import { db } from '../server/db.ts';

// First column of the supplied CSV; deliberately never print the codes.
try {
  const file = process.argv[2];
  if (!file) throw new Error('用法：npm run benefits:import -- /绝对路径/兑换码.csv');
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const cells = text.split(/\r?\n/).filter((line) => line.trim()).map((line) => {
    const match = /^(?:"((?:[^"]|"")*)"|([^,]*))(?:,|$)/.exec(line);
    if (!match) throw new Error('CSV 第一列格式无效');
    return (match[1]?.replace(/""/g, '"') ?? match[2]).trim();
  });
  if (/^(code|offer\s*code|兑换码|订阅码)$/i.test(cells[0] ?? '')) cells.shift();
  console.log(`成功导入 ${importMarginNoteCodes(cells)} 个新兑换码（重复码已跳过）`);
} catch (error) {
  console.error(error instanceof Error ? error.message : '导入失败');
  process.exitCode = 1;
} finally { db.close(); }
