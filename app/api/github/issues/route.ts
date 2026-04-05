import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { extractToken, verifyToken } from '@/lib/auth';
import { config } from '@/lib/config';
import { recordAudit } from '@/lib/audit';

interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string;
  state: string;
  created_at: string;
  updated_at: string;
  html_url: string;
  user: { login: string };
  labels: { name: string }[];
  pull_request?: { html_url: string };
}

interface GitHubPullRequest {
  html_url: string;
  body: string | null;
  merged_at: string | null;
  merge_commit_sha: string | null;
}

interface FilesChangedBreakdown {
  total: number;
  code: number;
  docs: number;
  additions: number;
  deletions: number;
}

interface ProcessedIssue {
  id: number;
  number: number;
  title: string;
  description: string;
  state: string;
  url: string;
  author: string;
  labels: string[];
  linkedPR?: string;
  commitHash?: string;
  filesChanged: FilesChangedBreakdown;
  owner: string;
  repo: string;
  isBlacklisted: boolean;
  createdAt: string;
  updatedAt: string;
  /** True when the linked PR is merged; false when it is still open. */
  prMerged: boolean;
}

type LinkResult = { prUrl: string; commitHash: string } | null;
type AppliedLimits = {
  maxAnalyzeIssues: number;
  maxIssuePages: number;
  maxPullPages: number;
  minCodeFileChanges: number;
};
type AnalysisPayload = {
  success: boolean;
  count: number;
  inspectedCount: number;
  issues: ProcessedIssue[];
  appliedLimits: AppliedLimits;
  repoBlacklisted: boolean;
  warning?: string;
};

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const RESULT_CACHE_TTL_MS = 5 * 60 * 1000;
const LINK_CACHE_TTL_MS = 30 * 60 * 1000;
const FILES_CACHE_TTL_MS = 30 * 60 * 1000;

const PR_CLOSING_PATTERN =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+(?:(?:https?:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/)|(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#)|#)(\d+)\b/gi;

const analysisCache = new Map<string, CacheEntry<AnalysisPayload>>();
const linkedPrCache = new Map<string, CacheEntry<LinkResult>>();
const prFilesCache = new Map<string, CacheEntry<FilesChangedBreakdown>>();

function clampPositiveInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.floor(parsed);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

function getCached<T>(map: Map<string, CacheEntry<T>>, key: string): T | null {
  const hit = map.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    map.delete(key);
    return null;
  }
  return hit.value;
}

function setCached<T>(
  map: Map<string, CacheEntry<T>>,
  key: string,
  value: T,
  ttlMs: number
) {
  map.set(key, { value, expiresAt: Date.now() + ttlMs });
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const result: R[] = new Array(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      result[index] = await mapper(items[index]);
    }
  });

  await Promise.all(workers);
  return result;
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = extractToken(authHeader);

    if (!token) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const user = verifyToken(token);
    if (!user) {
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      );
    }

    const {
      owner,
      repo,
      maxAnalyzeIssues,
      maxIssuePages,
      maxPullPages,
      minCodeFileChanges,
      forceFetchBlacklistedRepo,
      includeOpenIssues,
    } = await request.json();

    if (!owner || !repo) {
      return NextResponse.json(
        { error: 'Owner and repo are required' },
        { status: 400 }
      );
    }

    const ownerNorm = String(owner).trim().toLowerCase();
    const repoNorm = String(repo)
      .trim()
      .toLowerCase()
      .replace(/\.git$/i, '');

    const repoBlacklisted = await db.blacklist.isRepoBlacklisted(ownerNorm, repoNorm);
    if (repoBlacklisted && !forceFetchBlacklistedRepo) {
      return NextResponse.json(
        {
          error: 'This repository is blacklisted.',
          code: 'REPO_BLACKLISTED',
        },
        { status: 409 }
      );
    }

    const effectiveMaxAnalyzeIssues = clampPositiveInt(
      maxAnalyzeIssues,
      config.github.maxAnalyzeIssues,
      1,
      500
    );
    const effectiveMaxIssuePages = clampPositiveInt(
      maxIssuePages,
      config.github.maxIssuePages,
      1,
      20
    );
    const effectiveMaxPullPages = clampPositiveInt(
      maxPullPages,
      config.github.maxPullPages,
      1,
      20
    );
    const effectiveMinCodeFileChanges = clampPositiveInt(
      minCodeFileChanges,
      config.github.minCodeFileChanges,
      0,
      1000
    );
    const appliedLimits = {
      maxAnalyzeIssues: effectiveMaxAnalyzeIssues,
      maxIssuePages: effectiveMaxIssuePages,
      maxPullPages: effectiveMaxPullPages,
      minCodeFileChanges: effectiveMinCodeFileChanges,
    };
    const includeOpen = Boolean(includeOpenIssues);
    const analysisCacheKey = JSON.stringify({
      owner: ownerNorm,
      repo: repoNorm,
      appliedLimits,
      forceFetchBlacklistedRepo: Boolean(forceFetchBlacklistedRepo),
      includeOpenIssues: includeOpen,
    });
    const cachedResponse = getCached(analysisCache, analysisCacheKey);
    if (cachedResponse) {
      return NextResponse.json(cachedResponse, { status: 200 });
    }

    const apiKey = await db.apiKey.resolveForGithubRequest(user.userId);

    if (!apiKey) {
      return NextResponse.json(
        { error: 'No GitHub API key configured. Ask admin to add one in Admin Panel.' },
        { status: 400 }
      );
    }
    const githubToken = apiKey.token;

    const issues = await fetchRepoIssues(
      githubToken,
      ownerNorm,
      repoNorm,
      config.github.issuesPerPage,
      effectiveMaxIssuePages,
      includeOpen
    );
    if (issues.length === 0) {
      return NextResponse.json(
        {
          success: true,
          count: 0,
          inspectedCount: 0,
          issues: [],
          appliedLimits,
          warning: includeOpen
            ? 'No issues fetched. Check token/repo access or increase issue page limit.'
            : 'No closed issues fetched. Check token/repo access or increase issue page limit.',
        },
        { status: 200 }
      );
    }
    const mergedPrReferenceMap = await getMergedPrReferenceMap(
      githubToken,
      ownerNorm,
      repoNorm,
      effectiveMaxPullPages
    );
    const openPrReferenceMap = includeOpen
      ? await getOpenPrReferenceMap(
          githubToken,
          ownerNorm,
          repoNorm,
          effectiveMaxPullPages,
          new Set(mergedPrReferenceMap.keys())
        )
      : new Map<number, { prUrl: string }>();

    const candidateIssues = issues
      .filter((issue) => !issue.pull_request)
      .slice(0, effectiveMaxAnalyzeIssues);

    const processed = await mapWithConcurrency(
      candidateIssues,
      14,
      async (issue): Promise<ProcessedIssue | null> => {
        const issueBlacklisted = await db.blacklist.isIssueBlacklisted(
          ownerNorm,
          repoNorm,
          issue.number
        );

        const mergedPrMatch = mergedPrReferenceMap.get(issue.number);
        const openPrMatch = openPrReferenceMap.get(issue.number);
        let linkedPrUrl: string;
        let linkedCommitHash: string;
        let prMerged: boolean;

        if (mergedPrMatch) {
          linkedPrUrl = mergedPrMatch.prUrl;
          linkedCommitHash = mergedPrMatch.commitHash;
          prMerged = true;
        } else if (openPrMatch) {
          linkedPrUrl = openPrMatch.prUrl;
          linkedCommitHash = '';
          prMerged = false;
        } else {
          const fromTimeline = await checkLinkedPR(
            githubToken,
            ownerNorm,
            repoNorm,
            issue.number
          );
          if (!fromTimeline?.prUrl) {
            return null;
          }
          linkedPrUrl = fromTimeline.prUrl;
          linkedCommitHash = fromTimeline.commitHash;
          prMerged = await isPullMerged(
            githubToken,
            ownerNorm,
            repoNorm,
            linkedPrUrl
          );
        }

        const filesChanged = await countChangedFiles(
          githubToken,
          ownerNorm,
          repoNorm,
          linkedPrUrl
        );
        if (filesChanged.code < effectiveMinCodeFileChanges) {
          return null;
        }

        return {
          id: issue.id,
          number: issue.number,
          title: issue.title,
          description: issue.body || '',
          state: issue.state,
          url: issue.html_url,
          author: issue.user.login,
          labels: issue.labels.map((l) => l.name),
          linkedPR: linkedPrUrl,
          commitHash: linkedCommitHash,
          prMerged,
          filesChanged,
          owner: ownerNorm,
          repo: repoNorm,
          isBlacklisted: issueBlacklisted,
          createdAt: issue.created_at,
          updatedAt: issue.updated_at,
        } satisfies ProcessedIssue;
      }
    );
    const processedIssues = processed.filter(
      (issue): issue is ProcessedIssue => issue !== null
    );
    const payload = {
      success: true,
      count: processedIssues.length,
      inspectedCount: candidateIssues.length,
      issues: processedIssues,
      appliedLimits,
      repoBlacklisted,
    };
    setCached(analysisCache, analysisCacheKey, payload, RESULT_CACHE_TTL_MS);
    void recordAudit({
      userId: user.userId,
      action: 'issue_finder.fetch',
      details: {
        owner: ownerNorm,
        repo: repoNorm,
        includeOpenIssues: includeOpen,
        resultCount: processedIssues.length,
      },
    });
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error('GitHub API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

async function checkLinkedPR(
  token: string,
  owner: string,
  repo: string,
  issueNumber: number
): Promise<{ prUrl: string; commitHash: string } | null> {
  const cacheKey = `${owner}/${repo}#${issueNumber}`;
  const cached = linkedPrCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached && cached.expiresAt <= Date.now()) linkedPrCache.delete(cacheKey);
  try {
    const timelineResponse = await fetch(
      `${config.github.apiBaseUrl}/repos/${owner}/${repo}/issues/${issueNumber}/timeline`,
      {
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github+json',
        },
      }
    );

    if (timelineResponse.ok) {
      const timelineEvents = (await timelineResponse.json()) as Array<{
        event?: string;
        source?: {
          issue?: {
            html_url?: string;
            pull_request?: { html_url?: string };
          };
        };
      }>;

      for (const event of timelineEvents) {
        const prFromSource = event.source?.issue?.pull_request?.html_url;
        if (prFromSource) {
          const resolved = { prUrl: prFromSource, commitHash: '' };
          setCached(linkedPrCache, cacheKey, resolved, LINK_CACHE_TTL_MS);
          return resolved;
        }
      }
    }

    const url = `${config.github.apiBaseUrl}/repos/${owner}/${repo}/issues/${issueNumber}/events`;
    const response = await fetch(url, {
      headers: {
        Authorization: `token ${token}`,
        Accept: config.github.acceptHeader,
      },
    });

    if (!response.ok) return null;

    const events = await response.json();
    for (const event of events) {
      if (event.event === 'closed' && event.commit_url) {
        const commitMatch = event.commit_url.match(/\/commits\/(.+)$/);
        if (commitMatch) {
          const sha = commitMatch[1];
          const prResponse = await fetch(
            `${config.github.apiBaseUrl}/repos/${owner}/${repo}/commits/${sha}/pulls`,
            {
              headers: {
                Authorization: `token ${token}`,
                Accept: config.github.acceptHeader,
              },
            }
          );

          if (prResponse.ok) {
            const prs = await prResponse.json();
            if (prs.length > 0) {
              const resolved = { prUrl: prs[0].html_url, commitHash: sha };
              setCached(linkedPrCache, cacheKey, resolved, LINK_CACHE_TTL_MS);
              return resolved;
            }
          }
        }
      }
    }
    setCached(linkedPrCache, cacheKey, null, LINK_CACHE_TTL_MS);
    return null;
  } catch {
    setCached(linkedPrCache, cacheKey, null, LINK_CACHE_TTL_MS);
    return null;
  }
}

async function getMergedPrReferenceMap(
  token: string,
  owner: string,
  repo: string,
  maxPullPages: number
): Promise<Map<number, { prUrl: string; commitHash: string }>> {
  const issueToPr = new Map<number, { prUrl: string; commitHash: string }>();

  try {
    const pages = Array.from({ length: maxPullPages }, (_, i) => i + 1);
    const pageResults = await mapWithConcurrency(pages, 6, async (page) => {
      const response = await fetch(
        `${config.github.apiBaseUrl}/repos/${owner}/${repo}/pulls?state=closed&per_page=100&page=${page}`,
        {
          headers: {
            Authorization: `token ${token}`,
            Accept: config.github.acceptHeader,
          },
        }
      );
      if (!response.ok) return [] as GitHubPullRequest[];
      const pagePrs = (await response.json()) as GitHubPullRequest[];
      return Array.isArray(pagePrs) ? pagePrs : [];
    });
    const prs: GitHubPullRequest[] = pageResults.flat();

    for (const pr of prs) {
      if (!pr.merged_at || !pr.body || !pr.html_url) continue;

      for (const match of pr.body.matchAll(PR_CLOSING_PATTERN)) {
        const issueNumber = Number(match[1]);
        if (Number.isNaN(issueNumber)) continue;
        if (!issueToPr.has(issueNumber)) {
          issueToPr.set(issueNumber, {
            prUrl: pr.html_url,
            commitHash: pr.merge_commit_sha || '',
          });
        }
      }
    }
  } catch {
    return issueToPr;
  }

  return issueToPr;
}

async function getOpenPrReferenceMap(
  token: string,
  owner: string,
  repo: string,
  maxPullPages: number,
  mergedIssueNumbers: Set<number>
): Promise<Map<number, { prUrl: string }>> {
  const issueToPr = new Map<number, { prUrl: string }>();

  try {
    const pages = Array.from({ length: maxPullPages }, (_, i) => i + 1);
    const pageResults = await mapWithConcurrency(pages, 6, async (page) => {
      const response = await fetch(
        `${config.github.apiBaseUrl}/repos/${owner}/${repo}/pulls?state=open&per_page=100&page=${page}`,
        {
          headers: {
            Authorization: `token ${token}`,
            Accept: config.github.acceptHeader,
          },
        }
      );
      if (!response.ok) return [] as GitHubPullRequest[];
      const pagePrs = (await response.json()) as GitHubPullRequest[];
      return Array.isArray(pagePrs) ? pagePrs : [];
    });
    const prs: GitHubPullRequest[] = pageResults.flat();

    for (const pr of prs) {
      if (!pr.body || !pr.html_url) continue;

      for (const match of pr.body.matchAll(PR_CLOSING_PATTERN)) {
        const issueNumber = Number(match[1]);
        if (Number.isNaN(issueNumber)) continue;
        if (mergedIssueNumbers.has(issueNumber)) continue;
        if (!issueToPr.has(issueNumber)) {
          issueToPr.set(issueNumber, { prUrl: pr.html_url });
        }
      }
    }
  } catch {
    return issueToPr;
  }

  return issueToPr;
}

async function isPullMerged(
  token: string,
  owner: string,
  repo: string,
  prUrl: string
): Promise<boolean> {
  const prNumber = prUrl.split('/').pop()?.split('?')[0];
  if (!prNumber) return false;
  try {
    const res = await fetch(
      `${config.github.apiBaseUrl}/repos/${owner}/${repo}/pulls/${prNumber}`,
      {
        headers: {
          Authorization: `token ${token}`,
          Accept: config.github.acceptHeader,
        },
      }
    );
    if (!res.ok) return false;
    const pr = (await res.json()) as { merged_at?: string | null };
    return pr.merged_at != null && String(pr.merged_at).length > 0;
  } catch {
    return false;
  }
}

async function fetchRepoIssues(
  token: string,
  owner: string,
  repo: string,
  perPage: number,
  maxPages: number,
  includeOpen: boolean
): Promise<GitHubIssue[]> {
  const state = includeOpen ? 'all' : 'closed';
  const pages = Array.from({ length: maxPages }, (_, i) => i + 1);
  const pageResults = await mapWithConcurrency(pages, 6, async (page) => {
    const issuesUrl = `${config.github.apiBaseUrl}/repos/${owner}/${repo}/issues?state=${state}&per_page=${perPage}&page=${page}`;
    const issuesResponse = await fetch(issuesUrl, {
      headers: {
        Authorization: `token ${token}`,
        Accept: config.github.acceptHeader,
      },
    });
    if (!issuesResponse.ok) return [] as GitHubIssue[];
    const pageIssues = (await issuesResponse.json()) as GitHubIssue[];
    return Array.isArray(pageIssues) ? pageIssues : [];
  });
  const flattened = pageResults.flat();
  const byId = new Map<number, GitHubIssue>();
  for (const issue of flattened) {
    byId.set(issue.id, issue);
  }
  const deduped = Array.from(byId.values());
  deduped.sort(
    (a, b) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );
  return deduped;
}

async function countChangedFiles(
  token: string,
  owner: string,
  repo: string,
  prUrl: string
): Promise<FilesChangedBreakdown> {
  const prNumber = prUrl.split('/').pop();
  const cacheKey = `${owner}/${repo}#${prNumber}`;
  const cached = getCached(prFilesCache, cacheKey);
  if (cached) return cached;

  try {
    const url = `${config.github.apiBaseUrl}/repos/${owner}/${repo}/pulls/${prNumber}/files`;
    const response = await fetch(url, {
      headers: {
        Authorization: `token ${token}`,
        Accept: config.github.acceptHeader,
      },
    });

    if (!response.ok) {
      const empty = { total: 0, code: 0, docs: 0, additions: 0, deletions: 0 };
      setCached(prFilesCache, cacheKey, empty, FILES_CACHE_TTL_MS);
      return empty;
    }

    const files: { filename: string; additions: number; deletions: number }[] =
      await response.json();
    const total = files.length;
    const codeFiles = files.filter((f) =>
      config.github.codeFileExtensions.some((ext) => f.filename.endsWith(ext))
    );
    const code = codeFiles.length;
    const docs = files.filter((f) =>
      config.github.docFileExtensions.some((ext) => f.filename.endsWith(ext))
    ).length;
    const additions = codeFiles.reduce((sum, file) => sum + (file.additions || 0), 0);
    const deletions = codeFiles.reduce((sum, file) => sum + (file.deletions || 0), 0);

    const summary = { total, code, docs, additions, deletions };
    setCached(prFilesCache, cacheKey, summary, FILES_CACHE_TTL_MS);
    return summary;
  } catch {
    const empty = { total: 0, code: 0, docs: 0, additions: 0, deletions: 0 };
    setCached(prFilesCache, cacheKey, empty, FILES_CACHE_TTL_MS);
    return empty;
  }
}
