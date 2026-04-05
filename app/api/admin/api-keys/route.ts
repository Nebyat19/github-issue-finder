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

  const isAdmin = user.role === 'admin' || user.isAdmin;
  return isAdmin ? user : null;
}

export async function GET(request: NextRequest) {
  try {
    const admin = await getAdminUser(request);
    if (!admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const users = await db.user.findMany();
    const keys = await db.apiKey.findMany();
    const userById = new Map(users.map((u) => [u.id, u]));

    return NextResponse.json(
      {
        success: true,
        apiKeys: keys.map((key) => ({
          id: key.id,
          token: key.token,
          isActive: key.isActive,
          userId: key.userId,
          userEmail: userById.get(key.userId)?.email ?? 'Unknown',
          createdAt: key.createdAt,
        })),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('List API keys error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await getAdminUser(request);
    if (!admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { email, token } = await request.json();
    const normalizedToken = String(token || '').trim();

    if (!normalizedToken) {
      return NextResponse.json(
        { error: 'GitHub token is required' },
        { status: 400 }
      );
    }

    const normalizedEmail = String(email || '').trim().toLowerCase();
    const targetUser = normalizedEmail
      ? await db.user.findUnique({ where: { email: normalizedEmail } })
      : admin;
    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const key = await db.apiKey.create({
      userId: targetUser.id,
      token: normalizedToken,
      isActive: true,
    });

    void recordAudit({
      userId: admin.id,
      action: 'admin.api_key.create',
      details: { keyId: key.id, targetUserId: targetUser.id },
    });

    return NextResponse.json(
      {
        success: true,
        apiKey: {
          id: key.id,
          token: key.token,
          isActive: key.isActive,
          userId: key.userId,
          userEmail: targetUser.email,
          createdAt: key.createdAt,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Create API key error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

