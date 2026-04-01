import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { extractToken, verifyToken } from '@/lib/auth';
import { config } from '@/lib/config';

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
}

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
      forceFetchBlacklistedRepo,
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

    const repoBlacklisted = db.blacklist.isRepoBlacklisted(ownerNorm, repoNorm);
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
    const appliedLimits = {
      maxAnalyzeIssues: effectiveMaxAnalyzeIssues,
      maxIssuePages: effectiveMaxIssuePages,
      maxPullPages: effectiveMaxPullPages,
    };

    const apiKey = await db.apiKey.resolveForGithubRequest(user.userId);

    if (!apiKey) {
      return NextResponse.json(
        { error: 'No GitHub API key configured. Ask admin to add one in Admin Panel.' },
        { status: 400 }
      );
    }
    const githubToken = apiKey.token;

    const issues = await fetchClosedIssues(
      githubToken,
      ownerNorm,
      repoNorm,
      config.github.issuesPerPage,
      effectiveMaxIssuePages
    );
    if (issues.length === 0) {
      return NextResponse.json(
        {
          success: true,
          count: 0,
          inspectedCount: 0,
          issues: [],
          appliedLimits,
          warning:
            'No closed issues fetched. Check token/repo access or increase issue page limit.',
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

    const candidateIssues = issues
      .filter((issue) => !issue.pull_request)
      .slice(0, effectiveMaxAnalyzeIssues);

    const processedIssues: ProcessedIssue[] = [];
    const chunkSize = 5;

    for (let i = 0; i < candidateIssues.length; i += chunkSize) {
      const chunk = candidateIssues.slice(i, i + chunkSize);
      const chunkResults: Array<ProcessedIssue | null> = await Promise.all(
        chunk.map(async (issue): Promise<ProcessedIssue | null> => {
          const issueBlacklisted = db.blacklist.isIssueBlacklisted(
            ownerNorm,
            repoNorm,
            issue.number
          );

          const mergedPrMatch = mergedPrReferenceMap.get(issue.number);
          const linkedResult =
            mergedPrMatch ??
            (await checkLinkedPR(githubToken, ownerNorm, repoNorm, issue.number));

          if (!linkedResult?.prUrl) {
            return null;
          }

          let filesChanged: FilesChangedBreakdown = {
            total: 0,
            code: 0,
            docs: 0,
            additions: 0,
            deletions: 0,
          };
          filesChanged = await countChangedFiles(
            githubToken,
            ownerNorm,
            repoNorm,
            linkedResult.prUrl
          );

          return {
            id: issue.id,
            number: issue.number,
            title: issue.title,
            description: issue.body || '',
            state: issue.state,
            url: issue.html_url,
            author: issue.user.login,
            labels: issue.labels.map((l) => l.name),
            linkedPR: linkedResult.prUrl,
            commitHash: linkedResult.commitHash,
            filesChanged,
            owner: ownerNorm,
            repo: repoNorm,
            isBlacklisted: issueBlacklisted,
            createdAt: issue.created_at,
            updatedAt: issue.updated_at,
          } satisfies ProcessedIssue;
        })
      );
      processedIssues.push(...chunkResults.filter((issue): issue is ProcessedIssue => issue !== null));
    }

    return NextResponse.json(
      {
        success: true,
        count: processedIssues.length,
        inspectedCount: candidateIssues.length,
        issues: processedIssues,
        appliedLimits,
        repoBlacklisted,
      },
      { status: 200 }
    );
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
          return { prUrl: prFromSource, commitHash: '' };
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
              return { prUrl: prs[0].html_url, commitHash: sha };
            }
          }
        }
      }
    }
    return null;
  } catch {
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
    const prs: GitHubPullRequest[] = [];
    for (let page = 1; page <= maxPullPages; page += 1) {
      const response = await fetch(
        `${config.github.apiBaseUrl}/repos/${owner}/${repo}/pulls?state=closed&per_page=100&page=${page}`,
        {
          headers: {
            Authorization: `token ${token}`,
            Accept: config.github.acceptHeader,
          },
        }
      );
      if (!response.ok) break;

      const pagePrs = (await response.json()) as GitHubPullRequest[];
      if (!Array.isArray(pagePrs) || pagePrs.length === 0) break;
      prs.push(...pagePrs);
      if (pagePrs.length < 100) break;
    }
    const closingPattern =
      /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+(?:(?:https?:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/)|(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#)|#)(\d+)\b/gi;

    for (const pr of prs) {
      if (!pr.merged_at || !pr.body || !pr.html_url) continue;

      for (const match of pr.body.matchAll(closingPattern)) {
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

async function fetchClosedIssues(
  token: string,
  owner: string,
  repo: string,
  perPage: number,
  maxPages: number
): Promise<GitHubIssue[]> {
  const issues: GitHubIssue[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const issuesUrl = `${config.github.apiBaseUrl}/repos/${owner}/${repo}/issues?state=closed&per_page=${perPage}&page=${page}`;
    const issuesResponse = await fetch(issuesUrl, {
      headers: {
        Authorization: `token ${token}`,
        Accept: config.github.acceptHeader,
      },
    });

    if (!issuesResponse.ok) {
      break;
    }

    const pageIssues = (await issuesResponse.json()) as GitHubIssue[];
    if (!Array.isArray(pageIssues) || pageIssues.length === 0) {
      break;
    }

    issues.push(...pageIssues);
    if (pageIssues.length < perPage) {
      break;
    }
  }

  return issues;
}

async function countChangedFiles(
  token: string,
  owner: string,
  repo: string,
  prUrl: string
): Promise<FilesChangedBreakdown> {
  try {
    const prNumber = prUrl.split('/').pop();
    const url = `${config.github.apiBaseUrl}/repos/${owner}/${repo}/pulls/${prNumber}/files`;
    const response = await fetch(url, {
      headers: {
        Authorization: `token ${token}`,
        Accept: config.github.acceptHeader,
      },
    });

    if (!response.ok) {
      return { total: 0, code: 0, docs: 0, additions: 0, deletions: 0 };
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

    return { total, code, docs, additions, deletions };
  } catch {
    return { total: 0, code: 0, docs: 0, additions: 0, deletions: 0 };
  }
}
