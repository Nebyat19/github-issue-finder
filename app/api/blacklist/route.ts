import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { extractToken, verifyToken } from '@/lib/auth';
import {
  parseIssueBlacklistInput,
  parseRepoBlacklistInput,
} from '@/lib/blacklist-parse';

function getSessionUser(request: NextRequest) {
  const token = extractToken(request.headers.get('authorization'));
  if (!token) return null;
  return verifyToken(token);
}

export async function GET(request: NextRequest) {
  try {
    const user = getSessionUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const entries = await db.blacklist.findMany();
    return NextResponse.json({
      success: true,
      entries: entries.map((e) => ({
        id: e.id,
        kind: e.kind,
        owner: e.owner,
        repo: e.repo,
        issueNumber: e.issueNumber,
        label:
          e.kind === 'repo'
            ? `${e.owner}/${e.repo}`
            : `${e.owner}/${e.repo}#${e.issueNumber}`,
        createdAt: e.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('Blacklist GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = getSessionUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json()) as {
      kind?: string;
      url?: string;
      owner?: string;
      repo?: string;
      issueNumber?: number;
    };

    const kind = body.kind === 'issue' ? 'issue' : 'repo';

    let owner: string | undefined;
    let repo: string | undefined;
    let issueNumber: number | undefined;

    const url = typeof body.url === 'string' ? body.url.trim() : '';
    if (url) {
      if (kind === 'repo') {
        const parsed = parseRepoBlacklistInput(url);
        if (!parsed) {
          return NextResponse.json(
            { error: 'Invalid repository URL or owner/repo' },
            { status: 400 }
          );
        }
        owner = parsed.owner;
        repo = parsed.repo;
      } else {
        const parsed = parseIssueBlacklistInput(url);
        if (!parsed) {
          return NextResponse.json({ error: 'Invalid issue URL' }, { status: 400 });
        }
        owner = parsed.owner;
        repo = parsed.repo;
        issueNumber = parsed.issueNumber;
      }
    } else {
      owner = String(body.owner || '').trim().toLowerCase();
      repo = String(body.repo || '')
        .trim()
        .toLowerCase()
        .replace(/\.git$/i, '');
      if (body.issueNumber != null) {
        issueNumber = Math.floor(Number(body.issueNumber));
      }
    }

    if (!owner || !repo) {
      return NextResponse.json(
        { error: 'Owner and repo are required' },
        { status: 400 }
      );
    }

    if (kind === 'issue') {
      if (issueNumber == null || !Number.isFinite(issueNumber) || issueNumber < 1) {
        return NextResponse.json(
          { error: 'Issue number is required for issue blacklist' },
          { status: 400 }
        );
      }
    }

    const dup =
      kind === 'repo'
        ? db.blacklist.findDuplicate('repo', owner, repo)
        : db.blacklist.findDuplicate('issue', owner, repo, issueNumber);
    if (dup) {
      return NextResponse.json({ error: 'Already blacklisted' }, { status: 409 });
    }

    const entry = await db.blacklist.create({
      kind,
      owner,
      repo,
      issueNumber: kind === 'issue' ? issueNumber : undefined,
    });

    if (!entry) {
      return NextResponse.json(
        { error: 'Could not add blacklist entry' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        entry: {
          id: entry.id,
          kind: entry.kind,
          owner: entry.owner,
          repo: entry.repo,
          issueNumber: entry.issueNumber,
          label:
            entry.kind === 'repo'
              ? `${entry.owner}/${entry.repo}`
              : `${entry.owner}/${entry.repo}#${entry.issueNumber}`,
          createdAt: entry.createdAt.toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Blacklist POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
