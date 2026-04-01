/**
 * Parse user input for blacklist entries (repo or GitHub issue URLs, or owner/repo).
 */

export function parseRepoBlacklistInput(raw: string): {
  owner: string;
  repo: string;
} | null {
  const t = raw.trim();
  if (!t) return null;

  try {
    const url = new URL(t.includes('://') ? t : `https://${t}`);
    if (!url.hostname.toLowerCase().includes('github.com')) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    return {
      owner: parts[0].toLowerCase(),
      repo: parts[1].replace(/\.git$/i, '').toLowerCase(),
    };
  } catch {
    const slash = t.split('/').map((s) => s.trim()).filter(Boolean);
    if (slash.length === 2) {
      return {
        owner: slash[0].toLowerCase(),
        repo: slash[1].replace(/\.git$/i, '').toLowerCase(),
      };
    }
    return null;
  }
}

export function parseIssueBlacklistInput(raw: string): {
  owner: string;
  repo: string;
  issueNumber: number;
} | null {
  const t = raw.trim();
  if (!t) return null;

  try {
    const url = new URL(t.includes('://') ? t : `https://${t}`);
    if (!url.hostname.toLowerCase().includes('github.com')) return null;

    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 4 || parts[2] !== 'issues') return null;

    const issueNumber = Number(parts[3]);
    if (!Number.isFinite(issueNumber) || issueNumber < 1) return null;

    return {
      owner: parts[0].toLowerCase(),
      repo: parts[1].replace(/\.git$/i, '').toLowerCase(),
      issueNumber: Math.floor(issueNumber),
    };
  } catch {
    return null;
  }
}
