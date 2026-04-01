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

function githubAuthHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: config.github.acceptHeader,
  };
}

async function readGitHubErrorMessage(response: Response): Promise<string | null> {
  try {
    const raw = await response.text();
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { message?: string };
      if (typeof parsed.message === 'string' && parsed.message.trim()) {
        return parsed.message.trim();
      }
    } catch {
      /* not JSON */
    }
    return raw.slice(0, 300);
  } catch {
    return null;
  }
}

async function fetchClosedIssuesCount(
  token: string,
  fullName: string
): Promise<number> {
  try {
    const q = encodeURIComponent(`repo:${fullName} is:issue is:closed`);
    const response = await fetch(
      `${config.github.apiBaseUrl}/search/issues?q=${q}&per_page=1`,
      {
        headers: githubAuthHeaders(token),
      }
    );
    if (!response.ok) return 0;
    const data = (await response.json()) as { total_count?: number };
    return typeof data.total_count === 'number' ? data.total_count : 0;
  } catch {
    return 0;
  }
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
      minClosedIssues?: number;
      maxResults?: number;
    };

    const language = String(body.language || '').trim();
    const minStars = clampInt(body.minStars, 50, 0, 1_000_000);
    const minClosedIssues = clampInt(
      body.minClosedIssues ?? body.minIssues,
      10,
      0,
      1_000_000
    );
    const maxResults = clampInt(body.maxResults, 30, 1, 100);

    const qualifiers = [`stars:>=${minStars}`, 'archived:false', 'fork:false'];
    if (language) qualifiers.push(`language:${language}`);
    const query = encodeURIComponent(qualifiers.join(' '));

    const response = await fetch(
      `${config.github.apiBaseUrl}/search/repositories?q=${query}&sort=stars&order=desc&per_page=${maxResults}`,
      {
        headers: githubAuthHeaders(apiKey.token),
      }
    );

    if (!response.ok) {
      const ghMessage = await readGitHubErrorMessage(response);
      const fallback = 'Failed to search repositories on GitHub';
      const error = ghMessage || fallback;
      console.error(
        'repo-finder: GitHub search/repositories failed',
        response.status,
        error
      );

      if (response.status === 401) {
        return NextResponse.json(
          { error, code: 'GITHUB_UNAUTHORIZED' },
          { status: 401 }
        );
      }
      if (response.status === 403) {
        return NextResponse.json(
          { error, code: 'GITHUB_FORBIDDEN' },
          { status: 403 }
        );
      }
      if (response.status === 422) {
        return NextResponse.json(
          { error, code: 'GITHUB_VALIDATION' },
          { status: 422 }
        );
      }

      return NextResponse.json(
        { error, code: 'GITHUB_SEARCH_FAILED' },
        { status: 502 }
      );
    }

    const data = (await response.json()) as GitHubSearchResponse;
    const enriched = await mapWithConcurrency(
      data.items || [],
      8,
      async (repo) => {
        const closedIssues = await fetchClosedIssuesCount(apiKey.token, repo.full_name);
        const [owner, name] = repo.full_name.split('/');
        const isBlacklisted =
          !!owner &&
          !!name &&
          (await db.blacklist.isRepoBlacklisted(owner.toLowerCase(), name.toLowerCase()));
        return {
          id: repo.id,
          fullName: repo.full_name,
          url: repo.html_url,
          description: repo.description,
          stars: repo.stargazers_count,
          forks: repo.forks_count,
          closedIssues,
          language: repo.language,
          defaultBranch: repo.default_branch,
          updatedAt: repo.updated_at,
          isBlacklisted,
        };
      }
    );
    const filtered = enriched.filter((repo) => repo.closedIssues >= minClosedIssues);

    return NextResponse.json({
      success: true,
      count: filtered.length,
      repositories: filtered,
      filters: {
        language: language || null,
        minStars,
        minClosedIssues,
        maxResults,
      },
    });
  } catch (error) {
    console.error('Repo finder error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

