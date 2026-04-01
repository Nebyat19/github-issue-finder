import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { extractToken, verifyToken } from '@/lib/auth';
import { CHAT_BLACKLIST_REPOS } from '@/lib/chat-blacklist-repo-keys';

export const runtime = 'nodejs';

async function requireAdmin(request: NextRequest) {
  const token = extractToken(request.headers.get('authorization'));
  if (!token) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const decoded = verifyToken(token);
  if (!decoded) {
    return { error: NextResponse.json({ error: 'Invalid token' }, { status: 401 }) };
  }
  const user = await db.user.findUnique({ where: { id: decoded.userId } });
  const isAdmin = user?.role === 'admin' || user?.isAdmin;
  if (!user || !isAdmin) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { user };
}

/**
 * Bulk blacklist every repository listed in {@link CHAT_BLACKLIST_REPOS} (from team chat transcript).
 * POST /api/blacklistrepos
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  try {
    const added: { owner: string; repo: string }[] = [];
    const skippedDuplicate: { owner: string; repo: string }[] = [];
    const failed: { owner: string; repo: string; reason: string }[] = [];

    for (const { owner, repo } of CHAT_BLACKLIST_REPOS) {
      const dup = await db.blacklist.findDuplicate('repo', owner, repo);
      if (dup) {
        skippedDuplicate.push({ owner, repo });
        continue;
      }
      const entry = await db.blacklist.create({
        kind: 'repo',
        owner,
        repo,
      });
      if (!entry) {
        failed.push({ owner, repo, reason: 'create returned null' });
        continue;
      }
      added.push({ owner, repo });
    }

    return NextResponse.json({
      success: true,
      totalInList: CHAT_BLACKLIST_REPOS.length,
      added: added.length,
      skippedDuplicate: skippedDuplicate.length,
      failed: failed.length,
      addedRepos: added,
      skippedRepos: skippedDuplicate,
      failures: failed,
    });
  } catch (e) {
    console.error('blacklistrepos POST:', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
