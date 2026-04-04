import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { extractToken, verifyToken } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const token = extractToken(request.headers.get('authorization'));
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const currentUser = await db.user.findUnique({ where: { id: decoded.userId } });
    const isAdmin = currentUser?.role === 'admin' || currentUser?.isAdmin;
    if (!currentUser || !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
    console.error('Admin blacklist GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
