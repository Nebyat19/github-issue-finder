import { NextRequest, NextResponse } from 'next/server';
import { extractToken, verifyToken } from '@/lib/auth';
import { config } from '@/lib/config';
import { db } from '@/lib/db';

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

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = extractToken(authHeader);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = verifyToken(token);
    if (!user) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const { issueUrl } = await request.json();
    if (!issueUrl) {
      return NextResponse.json(
        { error: 'Issue URL is required' },
        { status: 400 }
      );
    }

    const apiKey = await db.apiKey.resolveForGithubRequest(user.userId);
    if (!apiKey) {
      return NextResponse.json(
        { error: 'No GitHub API key configured. Ask admin to add one in Admin Panel.' },
        { status: 400 }
      );
    }
    const githubToken = apiKey.token;

    const parsed = parseIssueUrl(issueUrl);
    if (!parsed) {
      return NextResponse.json(
        { error: 'Invalid GitHub issue URL format' },
        { status: 400 }
      );
    }

    const ownerLc = parsed.owner.trim().toLowerCase();
    const repoLc = parsed.repo.trim().toLowerCase().replace(/\.git$/i, '');

    if (await db.blacklist.isIssueBlacklisted(ownerLc, repoLc, parsed.issueNumber)) {
      return NextResponse.json(
        { error: 'This issue or repository is blacklisted.' },
        { status: 403 }
      );
    }

    const issueResponse = await fetch(
      `${config.github.apiBaseUrl}/repos/${ownerLc}/${repoLc}/issues/${parsed.issueNumber}`,
      {
        headers: {
          Authorization: `token ${githubToken}`,
          Accept: config.github.acceptHeader,
        },
      }
    );

    if (!issueResponse.ok) {
      return NextResponse.json({ error: 'Issue not found on GitHub' }, { status: 404 });
    }

    const issue = (await issueResponse.json()) as GitHubIssue;
    const mergedPrReferenceMap = await getMergedPrReferenceMap(
      githubToken,
      ownerLc,
      repoLc
    );
    const linkedResult =
      mergedPrReferenceMap.get(parsed.issueNumber) ??
      (await checkLinkedPR(
        githubToken,
        ownerLc,
        repoLc,
        parsed.issueNumber
      ));
    const filesChanged: FilesChangedBreakdown = linkedResult
      ? await countChangedFiles(githubToken, ownerLc, repoLc, linkedResult.prUrl)
      : { total: 0, code: 0, docs: 0, additions: 0, deletions: 0 };

    const prMerged =
      Boolean(linkedResult) &&
      (mergedPrReferenceMap.has(parsed.issueNumber) ||
        (await isPullMerged(
          githubToken,
          ownerLc,
          repoLc,
          linkedResult!.prUrl
        )));

    return NextResponse.json(
      {
        success: true,
        issue: {
          id: issue.id,
          number: issue.number,
          title: issue.title,
          description: issue.body || '',
          state: issue.state,
          url: issue.html_url,
          author: issue.user.login,
          labels: issue.labels.map((label) => label.name),
          linkedPR: linkedResult?.prUrl,
          commitHash: linkedResult?.commitHash,
          prMerged,
          filesChanged,
          owner: ownerLc,
          repo: repoLc,
          createdAt: issue.created_at,
          updatedAt: issue.updated_at,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Issue lookup error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
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

function parseIssueUrl(
  issueUrl: string
): { owner: string; repo: string; issueNumber: number } | null {
  try {
    const url = new URL(issueUrl);
    if (!url.hostname.includes('github.com')) return null;

    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 4 || parts[2] !== 'issues') return null;

    const issueNumber = Number(parts[3]);
    if (Number.isNaN(issueNumber)) return null;

    return {
      owner: parts[0],
      repo: parts[1],
      issueNumber,
    };
  } catch {
    return null;
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
        source?: {
          issue?: {
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

    const eventsResponse = await fetch(
      `${config.github.apiBaseUrl}/repos/${owner}/${repo}/issues/${issueNumber}/events`,
      {
        headers: {
          Authorization: `token ${token}`,
          Accept: config.github.acceptHeader,
        },
      }
    );
    if (!eventsResponse.ok) return null;

    const events = (await eventsResponse.json()) as Array<{
      event?: string;
      commit_url?: string;
    }>;

    for (const event of events) {
      if (event.event !== 'closed' || !event.commit_url) continue;

      const commitMatch = event.commit_url.match(/\/commits\/(.+)$/);
      if (!commitMatch) continue;

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

      if (!prResponse.ok) continue;
      const prs = (await prResponse.json()) as Array<{ html_url: string }>;
      if (prs.length === 0) continue;

      return { prUrl: prs[0].html_url, commitHash: sha };
    }

    return null;
  } catch {
    return null;
  }
}

async function getMergedPrReferenceMap(
  token: string,
  owner: string,
  repo: string
): Promise<Map<number, { prUrl: string; commitHash: string }>> {
  const issueToPr = new Map<number, { prUrl: string; commitHash: string }>();

  try {
    const response = await fetch(
      `${config.github.apiBaseUrl}/repos/${owner}/${repo}/pulls?state=closed&per_page=100`,
      {
        headers: {
          Authorization: `token ${token}`,
          Accept: config.github.acceptHeader,
        },
      }
    );
    if (!response.ok) return issueToPr;

    const prs = (await response.json()) as GitHubPullRequest[];
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

async function countChangedFiles(
  token: string,
  owner: string,
  repo: string,
  prUrl: string
): Promise<FilesChangedBreakdown> {
  try {
    const prNumber = prUrl.split('/').pop();
    if (!prNumber) return { total: 0, code: 0, docs: 0, additions: 0, deletions: 0 };

    const filesResponse = await fetch(
      `${config.github.apiBaseUrl}/repos/${owner}/${repo}/pulls/${prNumber}/files`,
      {
        headers: {
          Authorization: `token ${token}`,
          Accept: config.github.acceptHeader,
        },
      }
    );
    if (!filesResponse.ok) {
      return { total: 0, code: 0, docs: 0, additions: 0, deletions: 0 };
    }

    const files = (await filesResponse.json()) as Array<{
      filename: string;
      additions: number;
      deletions: number;
    }>;
    const total = files.length;
    const codeFiles = files.filter((file) =>
      config.github.codeFileExtensions.some((ext) => file.filename.endsWith(ext))
    );
    const code = codeFiles.length;
    const docs = files.filter((file) =>
      config.github.docFileExtensions.some((ext) => file.filename.endsWith(ext))
    ).length;
    const additions = codeFiles.reduce(
      (sum, file) => sum + (file.additions || 0),
      0
    );
    const deletions = codeFiles.reduce(
      (sum, file) => sum + (file.deletions || 0),
      0
    );

    return { total, code, docs, additions, deletions };
  } catch {
    return { total: 0, code: 0, docs: 0, additions: 0, deletions: 0 };
  }
}

