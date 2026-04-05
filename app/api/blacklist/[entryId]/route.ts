import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { extractToken, verifyToken } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';

function getSessionUser(request: NextRequest) {
  const token = extractToken(request.headers.get('authorization'));
  if (!token) return null;
  return verifyToken(token);
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ entryId: string }> }
) {
  try {
    const user = getSessionUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { entryId } = await context.params;
    if (!entryId) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }

    const deleted = await db.blacklist.delete({ where: { id: entryId } });
    if (!deleted) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    void recordAudit({
      userId: user.userId,
      action: 'blacklist.remove',
      details: {
        entryId: deleted.id,
        kind: deleted.kind,
        owner: deleted.owner,
        repo: deleted.repo,
        issueNumber: deleted.issueNumber,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Blacklist DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
