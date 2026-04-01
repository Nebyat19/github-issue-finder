import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { extractToken, verifyToken } from '@/lib/auth';
import { config } from '@/lib/config';

interface GitHubRepo {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  default_branch: string;
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

    const { owner, repo } = await request.json();
    if (!owner || !repo) {
      return NextResponse.json({ error: 'Owner and repo are required' }, { status: 400 });
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

    const response = await fetch(
      `${config.github.apiBaseUrl}/repos/${ownerNorm}/${repoNorm}`,
      {
        headers: {
          Authorization: `token ${apiKey.token}`,
          Accept: config.github.acceptHeader,
        },
      }
    );

    if (!response.ok) {
      return NextResponse.json({ error: 'Repository not found on GitHub' }, { status: 404 });
    }

    const repository = (await response.json()) as GitHubRepo;
    return NextResponse.json(
      {
        success: true,
        repository: {
          fullName: repository.full_name,
          url: repository.html_url,
          description: repository.description,
          stars: repository.stargazers_count,
          forks: repository.forks_count,
          openIssues: repository.open_issues_count,
          language: repository.language,
          defaultBranch: repository.default_branch,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Repo info error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

