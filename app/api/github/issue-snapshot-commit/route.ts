import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { extractToken, verifyToken } from '@/lib/auth';
import { config } from '@/lib/config';

interface GitHubCommit {
  sha: string;
}

interface GitHubPullRequest {
  merged_at: string | null;
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

    if (db.blacklist.isRepoBlacklisted(ownerNorm, repoNorm)) {
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

    let untilDate: string | null = null;
    if (linkedPR) {
      const prNumber = String(linkedPR).split('/').pop();
      if (prNumber) {
        const prResponse = await fetch(
          `${config.github.apiBaseUrl}/repos/${ownerNorm}/${repoNorm}/pulls/${prNumber}`,
          {
            headers: {
              Authorization: `token ${apiKey.token}`,
              Accept: config.github.acceptHeader,
            },
          }
        );
        if (prResponse.ok) {
          const pr = (await prResponse.json()) as GitHubPullRequest;
          if (pr.merged_at) {
            untilDate = pr.merged_at;
          }
        }
      }
    }

    if (!untilDate && fallbackIssueCreatedAt) {
      untilDate = fallbackIssueCreatedAt;
    }
    if (!untilDate) {
      return NextResponse.json({ commitHash: null }, { status: 200 });
    }

    const until = encodeURIComponent(new Date(untilDate).toISOString());
    const response = await fetch(
      `${config.github.apiBaseUrl}/repos/${ownerNorm}/${repoNorm}/commits?until=${until}&per_page=1`,
      {
        headers: {
          Authorization: `token ${apiKey.token}`,
          Accept: config.github.acceptHeader,
        },
      }
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Unable to resolve snapshot commit' },
        { status: 400 }
      );
    }

    const commits = (await response.json()) as GitHubCommit[];
    if (!Array.isArray(commits) || commits.length === 0) {
      return NextResponse.json({ commitHash: null }, { status: 200 });
    }

    return NextResponse.json({ commitHash: commits[0].sha }, { status: 200 });
  } catch (error) {
    console.error('Issue snapshot commit error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

