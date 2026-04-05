import { prisma } from '@/lib/prisma';

export async function recordAudit(params: {
  userId: string | null;
  action: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId,
        action: params.action,
        details: params.details ? JSON.stringify(params.details) : null,
      },
    });
  } catch (e) {
    console.error('recordAudit failed:', e);
  }
}
