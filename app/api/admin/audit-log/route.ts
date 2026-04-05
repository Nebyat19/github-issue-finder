import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { extractToken, verifyToken } from '@/lib/auth';
import { db } from '@/lib/db';

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

function clampInt(n: unknown, fallback: number, min: number, max: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(v)));
}

export async function GET(request: NextRequest) {
  try {
    const admin = await getAdminUser(request);
    if (!admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const limit = clampInt(searchParams.get('limit'), 50, 1, 200);
    const offset = clampInt(searchParams.get('offset'), 0, 0, 10_000);

    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          user: { select: { email: true } },
        },
      }),
      prisma.auditLog.count(),
    ]);

    return NextResponse.json({
      success: true,
      total,
      offset,
      limit,
      entries: rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        userEmail: r.user?.email ?? null,
        action: r.action,
        details: r.details,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('Audit log GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
