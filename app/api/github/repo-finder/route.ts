import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { extractToken, verifyToken } from '@/lib/auth';
import { config } from '@/lib/config';

interface GitHubSearchRepoItem {
  id: number;
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  default_branch: string;
  updated_at: string;
}

interface GitHubSearchResponse {
  total_count: number;
  items: GitHubSearchRepoItem[];
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.floor(parsed);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

export async function POST(request: NextRequest) {
  try {
    const token = extractToken(request.headers.get('authorization'));
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = verifyToken(token);
    if (!user) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const apiKey = await db.apiKey.resolveForGithubRequest(user.userId);
    if (!apiKey) {
      return NextResponse.json(
        { error: 'No GitHub API key configured. Ask admin to add one in Admin Panel.' },
        { status: 400 }
      );
    }

    const body = (await request.json()) as {
      language?: string;
      minStars?: number;
      minIssues?: number;
      maxResults?: number;
    };

    const language = String(body.language || '').trim();
    const minStars = clampInt(body.minStars, 50, 0, 1_000_000);
    const minIssues = clampInt(body.minIssues, 10, 0, 1_000_000);
    const maxResults = clampInt(body.maxResults, 30, 1, 100);

    const qualifiers = [`stars:>=${minStars}`, 'archived:false', 'fork:false'];
    if (language) qualifiers.push(`language:${language}`);
    const query = encodeURIComponent(qualifiers.join(' '));

    const response = await fetch(
      `${config.github.apiBaseUrl}/search/repositories?q=${query}&sort=stars&order=desc&per_page=${maxResults}`,
      {
        headers: {
          Authorization: `token ${apiKey.token}`,
          Accept: config.github.acceptHeader,
        },
      }
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to search repositories on GitHub' },
        { status: 400 }
      );
    }

    const data = (await response.json()) as GitHubSearchResponse;
    const filtered = (data.items || [])
      .filter((repo) => repo.open_issues_count >= minIssues)
      .map((repo) => {
        const [owner, name] = repo.full_name.split('/');
        const isBlacklisted =
          !!owner &&
          !!name &&
          db.blacklist.isRepoBlacklisted(owner.toLowerCase(), name.toLowerCase());
        return {
          id: repo.id,
          fullName: repo.full_name,
          url: repo.html_url,
          description: repo.description,
          stars: repo.stargazers_count,
          forks: repo.forks_count,
          openIssues: repo.open_issues_count,
          language: repo.language,
          defaultBranch: repo.default_branch,
          updatedAt: repo.updated_at,
          isBlacklisted,
        };
      });

    return NextResponse.json({
      success: true,
      count: filtered.length,
      repositories: filtered,
      filters: {
        language: language || null,
        minStars,
        minIssues,
        maxResults,
      },
    });
  } catch (error) {
    console.error('Repo finder error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

