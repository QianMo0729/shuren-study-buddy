/**
 * Courses absent from the public Teaching Affairs snapshot, independently verified
 * against official university publications. These sources establish course identity,
 * not live TIS availability for a particular semester. Keep them separate so that
 * refreshing officialCourses.ts preserves its original source HTML checksum.
 */
export const SUPPLEMENTAL_COURSES = [
  {
    code: 'CS317',
    name: '计算机科学与技术前沿讲座 I',
    // Use the same department grouping as the public catalog's other CS courses.
    department: '计算机科学与工程系',
    verifiedAt: '2026-10-04',
    sources: [
      {
        title: '计算机科学与技术专业本科人才培养方案（2018级）',
        url: 'https://static.cse.sustech.edu.cn/upload/images/upload/files/20200812/1597207810597248.pdf',
        page: 4,
      },
      {
        title: '2021级本科人才培养方案：中文课程索引',
        url: 'https://mirrors.sustech.edu.cn/courses/本科人才培养方案/2021级本科人才培养方案/35-中文课程索引2021.pdf',
        page: 4,
      },
    ],
  },
] as const;
