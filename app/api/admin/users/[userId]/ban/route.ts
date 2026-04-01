import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { extractToken, verifyToken } from '@/lib/auth';

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ userId: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = extractToken(authHeader);

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const adminUser = await db.user.findUnique({ where: { id: decoded.userId } });
    const isAdmin = adminUser?.role === 'admin' || adminUser?.isAdmin;
    if (!adminUser || !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { userId } = await context.params;
    if (userId === adminUser.id) {
      return NextResponse.json(
        { error: 'You cannot ban your own account' },
        { status: 400 }
      );
    }

    const targetUser = await db.user.findUnique({ where: { id: userId } });
    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const targetIsAdmin = targetUser.role === 'admin' || targetUser.isAdmin;
    if (targetIsAdmin) {
      return NextResponse.json({ error: 'Admin users cannot be banned' }, { status: 400 });
    }

    const updatedUser = await db.user.update({
      where: { id: userId },
      data: { isBanned: true, isApproved: false },
    });
    if (!updatedUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json(
      {
        success: true,
        user: {
          id: updatedUser.id,
          email: updatedUser.email,
          role: updatedUser.role ?? (updatedUser.isAdmin ? 'admin' : 'user'),
          isApproved: updatedUser.isApproved,
          isBanned: updatedUser.isBanned,
          isAdmin: updatedUser.isAdmin,
          createdAt: updatedUser.createdAt,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Ban user error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

