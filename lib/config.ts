const DEFAULT_CODE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.py',
  '.java',
  '.go',
  '.rs',
  '.rb',
  '.php',
];

const DEFAULT_DOC_EXTENSIONS = [
  '.md',
  '.mdx',
  '.txt',
  '.rst',
  '.adoc',
  '.doc',
  '.docx',
  '.pdf',
  '.wiki',
];

function getNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const value = Number(raw);
  if (Number.isNaN(value) || value <= 0) return fallback;
  return value;
}

function getListEnv(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;

  const values = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return values.length > 0 ? values : fallback;
}

const fallbackJwtSecret = 'dev-only-secret-change-me';

export const config = {
  auth: {
    jwtSecret: process.env.JWT_SECRET || fallbackJwtSecret,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
    minPasswordLength: getNumberEnv('AUTH_MIN_PASSWORD_LENGTH', 8),
  },
  github: {
    apiBaseUrl: process.env.GITHUB_API_BASE_URL || 'https://api.github.com',
    acceptHeader:
      process.env.GITHUB_ACCEPT_HEADER || 'application/vnd.github.v3+json',
    issuesPerPage: getNumberEnv('GITHUB_ISSUES_PER_PAGE', 100),
    maxAnalyzeIssues: getNumberEnv('GITHUB_MAX_ANALYZE_ISSUES', 30),
    maxIssuePages: getNumberEnv('GITHUB_MAX_ISSUE_PAGES', 3),
    maxPullPages: getNumberEnv('GITHUB_MAX_PULL_PAGES', 3),
    minCodeFileChanges: getNumberEnv('MIN_CODE_FILE_CHANGES', 4),
    codeFileExtensions: getListEnv(
      'CODE_FILE_EXTENSIONS',
      DEFAULT_CODE_EXTENSIONS
    ),
    docFileExtensions: getListEnv(
      'DOC_FILE_EXTENSIONS',
      DEFAULT_DOC_EXTENSIONS
    ),
  },
  seed: {
    adminId: process.env.DEFAULT_ADMIN_ID || 'admin-001',
    adminEmail: process.env.DEFAULT_ADMIN_EMAIL || '',
    adminPasswordHash: process.env.DEFAULT_ADMIN_PASSWORD_HASH || '',
    adminPassword: process.env.DEFAULT_ADMIN_PASSWORD || '',
  },
};

