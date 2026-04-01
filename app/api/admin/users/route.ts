import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { extractToken, verifyToken } from '@/lib/auth';

export async function GET(request: NextRequest) {
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

    const currentUser = await db.user.findUnique({ where: { id: decoded.userId } });
    const isAdmin = currentUser?.role === 'admin' || currentUser?.isAdmin;
    if (!currentUser || !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const users = await db.user.findMany();
    return NextResponse.json(
      {
        success: true,
        users: users.map((user) => ({
          id: user.id,
          email: user.email,
          role: user.role ?? (user.isAdmin ? 'admin' : 'user'),
          isApproved: user.isApproved,
          isBanned: user.isBanned,
          isAdmin: user.isAdmin,
          createdAt: user.createdAt,
        })),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('List users error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

