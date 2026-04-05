import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { extractToken, verifyToken } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';

async function getAdminUser(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const token = extractToken(authHeader);
  if (!token) return null;

  const decoded = verifyToken(token);
  if (!decoded) return null;

  const user = await db.user.findUnique({ where: { id: decoded.userId } });
  if (!user) return null;

  return user.role === 'admin' || user.isAdmin ? user : null;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ keyId: string }> }
) {
  try {
    const admin = await getAdminUser(request);
    if (!admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { keyId } = await context.params;
    const { token, isActive } = await request.json();

    const existing = await db.apiKey.findUnique({ where: { id: keyId } });
    if (!existing) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 });
    }

    const nextToken =
      token === undefined ? undefined : String(token).trim();
    if (nextToken !== undefined && !nextToken) {
      return NextResponse.json({ error: 'Token cannot be empty' }, { status: 400 });
    }

    const updated = await db.apiKey.update({
      where: { id: keyId },
      data: {
        token: nextToken,
        isActive: typeof isActive === 'boolean' ? isActive : undefined,
      },
    });

    void recordAudit({
      userId: admin.id,
      action: 'admin.api_key.update',
      details: {
        keyId,
        tokenRotated: nextToken !== undefined,
        isActive:
          typeof isActive === 'boolean' ? isActive : existing.isActive,
      },
    });

    return NextResponse.json({ success: true, apiKey: updated }, { status: 200 });
  } catch (error) {
    console.error('Update API key error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ keyId: string }> }
) {
  try {
    const admin = await getAdminUser(request);
    if (!admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { keyId } = await context.params;
    const deleted = await db.apiKey.delete({ where: { id: keyId } });
    if (!deleted) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 });
    }

    void recordAudit({
      userId: admin.id,
      action: 'admin.api_key.delete',
      details: { keyId: deleted.id },
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Delete API key error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

