#!/usr/bin/env python3
"""Rebuild the checked-in catalog from a manually downloaded official HTML page.

curl -fL 'https://course-tao.sustech.edu.cn/kcxxweb/queryKcxxwebListChinesePC' -o /tmp/courses.html
python3 scripts/import-course-catalog.py /tmp/courses.html --date YYYY-MM-DD

The public page renders its complete course table in HTML. Its accessibility
row count includes the header: the 2026-10-04 snapshot has 1,623 rows, comprising
one header and 1,622 unique course codes. No login, cookies, or TIS credentials
are involved. This script does not execute JavaScript or contact the site.
"""
import argparse
import hashlib
import json
import re
from datetime import date
from html.parser import HTMLParser
from pathlib import Path

SOURCE = 'https://course-tao.sustech.edu.cn/kcxxweb/queryKcxxwebListChinesePC'


class CourseTableParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows = []
        self.row = None
        self.cell = None

    def handle_starttag(self, tag, attrs):
        if tag == 'tr':
            self.row = []
        if tag == 'td':
            self.cell = []

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag):
        if tag == 'td' and self.row is not None and self.cell is not None:
            self.row.append(re.sub(r'\s+', ' ', ''.join(self.cell)).strip())
            self.cell = None
        if tag == 'tr' and self.row is not None:
            self.rows.append(self.row)
            self.row = None


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument('html', type=Path)
    args.add_argument('--date', required=True, type=date.fromisoformat, help='Retrieval date, YYYY-MM-DD')
    args.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'shared/data/officialCourses.ts')
    options = args.parse_args()
    source = options.html.read_bytes()
    html = source.decode('utf-8')
    parser = CourseTableParser()
    parser.feed(html)
    rows = [row for row in parser.rows if len(row) == 5 and re.fullmatch(r'[A-Za-z0-9 -]+', row[0])]
    codes = {row[0] for row in rows}
    source_codes = set(re.findall(r"querykcxqbyChinesePC\('([^']+)'\)", html))
    if not rows or len(codes) != len(rows) or codes != source_codes:
        raise SystemExit('Catalog is empty, duplicate, or changed structure; inspect the source before updating.')
    result = f'// Official public course catalog, retrieved {options.date}.\n'
    result += f'// Source: {SOURCE}\n'
    result += '// This is the public Teaching Affairs catalog, not authenticated TIS semester enrollment data.\n'
    result += f'// Source HTML SHA-256: {hashlib.sha256(source).hexdigest()}\n'
    result += 'export const OFFICIAL_COURSE_ROWS: readonly (readonly [code: string, name: string, department: string])[] = [\n'
    result += ''.join('  ' + json.dumps([row[0], row[1], row[4]], ensure_ascii=False) + ',\n' for row in rows)
    result += '];\n'
    options.output.parent.mkdir(parents=True, exist_ok=True)
    options.output.write_text(result)
    print(f'Imported {len(rows)} unique courses to {options.output}.')
    print('Review the diff and update COURSE_CATALOG_UPDATED_AT and snapshot-count tests when needed.')


if __name__ == '__main__':
    main()
