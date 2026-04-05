import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { extractToken, verifyToken } from '@/lib/auth';
import { config } from '@/lib/config';

interface GitHubRepo {
  default_branch?: string;
}

interface GitHubPullRequest {
  merged_at: string | null;
}

interface GitHubListCommit {
  sha: string;
  commit: {
    committer?: { date?: string };
    author?: { date?: string };
  };
}

const COMMITS_PER_PAGE = 100;

function commitTimeMs(c: GitHubListCommit): number | null {
  const raw = c.commit?.committer?.date ?? c.commit?.author?.date;
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

function parseLastPageFromLink(link: string | null): number | null {
  if (!link) return null;
  for (const segment of link.split(',')) {
    if (!segment.includes('rel="last"')) continue;
    const m = segment.match(/[?&]page=(\d+)/);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

function commitsListUrl(
  apiBaseUrl: string,
  owner: string,
  repo: string,
  branch: string,
  issueOpenedMs: number,
  upperExclusiveMs: number,
  page: number
): string {
  const qs = new URLSearchParams();
  qs.set('sha', branch);
  qs.set('per_page', String(COMMITS_PER_PAGE));
  qs.set('page', String(page));
  qs.set('since', new Date(issueOpenedMs).toISOString());
  qs.set('until', new Date(upperExclusiveMs).toISOString());
  return `${apiBaseUrl}/repos/${owner}/${repo}/commits?${qs}`;
}

/**
 * Chronologically earliest commit on `branch` strictly after the issue opened and strictly before
 * `upperExclusiveMs`. GitHub returns commits newest-first; the last entry on the last page is the
 * oldest in the filtered range (two requests when Link rel="last" is present).
 */
async function findOldestCommitInWindow(params: {
  apiBaseUrl: string;
  owner: string;
  repo: string;
  branch: string;
  headers: Record<string, string>;
  issueOpenedMs: number;
  upperExclusiveMs: number;
}): Promise<string | null> {
  const { apiBaseUrl, owner, repo, branch, headers, issueOpenedMs, upperExclusiveMs } = params;

  const firstUrl = commitsListUrl(
    apiBaseUrl,
    owner,
    repo,
    branch,
    issueOpenedMs,
    upperExclusiveMs,
    1
  );
  const firstRes = await fetch(firstUrl, { headers });
  if (!firstRes.ok) {
    return null;
  }

  const firstList = (await firstRes.json()) as GitHubListCommit[];
  if (!Array.isArray(firstList) || firstList.length === 0) {
    return null;
  }

  const lastPage = parseLastPageFromLink(firstRes.headers.get('link')) ?? 1;
  let list = firstList;

  if (lastPage > 1) {
    const lastUrl = commitsListUrl(
      apiBaseUrl,
      owner,
      repo,
      branch,
      issueOpenedMs,
      upperExclusiveMs,
      lastPage
    );
    const lastRes = await fetch(lastUrl, { headers });
    if (!lastRes.ok) {
      return null;
    }
    const lastList = (await lastRes.json()) as GitHubListCommit[];
    if (!Array.isArray(lastList) || lastList.length === 0) {
      return null;
    }
    list = lastList;
  }

  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i];
    const t = commitTimeMs(c);
    if (t === null) continue;
    if (t <= issueOpenedMs || t >= upperExclusiveMs) continue;
    return c.sha;
  }

  return null;
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

    const { owner, repo, linkedPR, fallbackIssueCreatedAt } = await request.json();
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

    if (await db.blacklist.isRepoBlacklisted(ownerNorm, repoNorm)) {
      return NextResponse.json(
        { error: 'This repository is blacklisted.' },
        { status: 403 }
      );
    }

    const apiKey = await db.apiKey.resolveForGithubRequest(user.userId);
    if (!apiKey) {
      return NextResponse.json(
        { error: 'No GitHub API key configured. Ask admin to add one in Admin Panel.' },
        { status: 400 }
      );
    }

    const headers = {
      Authorization: `Bearer ${apiKey.token}`,
      Accept: config.github.acceptHeader,
    };

    const issueOpenedMs = fallbackIssueCreatedAt
      ? Date.parse(String(fallbackIssueCreatedAt))
      : NaN;
    if (!Number.isFinite(issueOpenedMs)) {
      return NextResponse.json({ commitHash: null }, { status: 200 });
    }

    const repoRes = await fetch(
      `${config.github.apiBaseUrl}/repos/${ownerNorm}/${repoNorm}`,
      { headers }
    );
    if (!repoRes.ok) {
      return NextResponse.json(
        { error: 'Unable to load repository' },
        { status: 400 }
      );
    }
    const repoJson = (await repoRes.json()) as GitHubRepo;
    const branch = (repoJson.default_branch || 'main').trim();

    let upperExclusiveMs = Date.now();
    if (linkedPR) {
      const prNumber = String(linkedPR).split('/').pop();
      if (prNumber) {
        const prResponse = await fetch(
          `${config.github.apiBaseUrl}/repos/${ownerNorm}/${repoNorm}/pulls/${prNumber}`,
          { headers }
        );
        if (prResponse.ok) {
          const pr = (await prResponse.json()) as GitHubPullRequest;
          if (pr.merged_at) {
            const m = Date.parse(pr.merged_at);
            if (Number.isFinite(m)) {
              upperExclusiveMs = m;
            }
          }
        }
      }
    }

    if (upperExclusiveMs <= issueOpenedMs) {
      return NextResponse.json({ commitHash: null }, { status: 200 });
    }

    const commitHash = await findOldestCommitInWindow({
      apiBaseUrl: config.github.apiBaseUrl,
      owner: ownerNorm,
      repo: repoNorm,
      branch,
      headers,
      issueOpenedMs,
      upperExclusiveMs,
    });

    return NextResponse.json({ commitHash }, { status: 200 });
  } catch (error) {
    console.error('Issue snapshot commit error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
