import { config } from '@/lib/config';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';

interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: 'admin' | 'user';
  isApproved: boolean;
  isBanned: boolean;
  isAdmin: boolean;
  createdAt: Date;
}

interface ApiKey {
  id: string;
  userId: string;
  token: string;
  isActive: boolean;
  createdAt: Date;
}

interface Repository {
  id: string;
  userId: string;
  owner: string;
  name: string;
  createdAt: Date;
}

interface Issue {
  id: string;
  repositoryId: string;
  number: number;
  title: string;
  author: string;
  linkedPR: string | null;
  codeFileChanges: number;
  createdAt: Date;
}

export type BlacklistKind = 'repo' | 'issue';

export interface BlacklistEntry {
  id: string;
  kind: BlacklistKind;
  owner: string;
  repo: string;
  issueNumber?: number;
  createdAt: Date;
}

interface InMemoryState {
  repositories: Map<string, Repository>;
  issues: Map<string, Issue>;
}

const globalDb = globalThis as typeof globalThis & {
  __issueFinderInMemoryDb?: InMemoryState;
  __issueFinderSeedPromise?: Promise<void>;
};

const state: InMemoryState =
  globalDb.__issueFinderInMemoryDb ??
  (globalDb.__issueFinderInMemoryDb = {
    repositories: new Map<string, Repository>(),
    issues: new Map<string, Issue>(),
  });

function toUser(row: {
  id: string;
  email: string;
  passwordHash: string;
  role: string;
  isApproved: boolean;
  isBanned: boolean;
  isAdmin: boolean;
  createdAt: Date;
}): User {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    role: row.role === 'admin' ? 'admin' : 'user',
    isApproved: row.isApproved,
    isBanned: row.isBanned,
    isAdmin: row.isAdmin,
    createdAt: row.createdAt,
  };
}

async function ensureSeeded(): Promise<void> {
  if (!globalDb.__issueFinderSeedPromise) {
    globalDb.__issueFinderSeedPromise = (async () => {
      const defaultAdminId = config.seed.adminId;
      const defaultAdminEmail = config.seed.adminEmail.trim().toLowerCase();
      const defaultAdminHash =
        config.seed.adminPasswordHash ||
        (config.seed.adminPassword ? bcrypt.hashSync(config.seed.adminPassword, 10) : '');

      if (!defaultAdminEmail || !defaultAdminHash) return;

      const byEmail = await prisma.user.findUnique({ where: { email: defaultAdminEmail } });
      if (byEmail) return;

      await prisma.user.create({
        data: {
          id: defaultAdminId,
          email: defaultAdminEmail,
          passwordHash: defaultAdminHash,
          role: 'admin',
          isApproved: true,
          isBanned: false,
          isAdmin: true,
        },
      });
    })();
  }
  await globalDb.__issueFinderSeedPromise;
}

export const db = {
  user: {
    create: async (input: {
      data: {
        email: string;
        passwordHash: string;
        isApproved?: boolean;
        isBanned?: boolean;
        role?: 'admin' | 'user';
        isAdmin?: boolean;
      };
    }) => {
      await ensureSeeded();
      const role = input.data.role ?? (input.data.isAdmin ? 'admin' : 'user');
      const created = await prisma.user.create({
        data: {
          email: input.data.email,
          passwordHash: input.data.passwordHash,
          role,
          isApproved: input.data.isApproved ?? false,
          isBanned: input.data.isBanned ?? false,
          isAdmin: role === 'admin',
        },
      });
      return toUser(created);
    },
    findUnique: async (query: { where: { email?: string; id?: string } }) => {
      await ensureSeeded();
      if (query.where.id) {
        const row = await prisma.user.findUnique({ where: { id: query.where.id } });
        return row ? toUser(row) : null;
      }
      if (!query.where.email) return null;
      const row = await prisma.user.findUnique({ where: { email: query.where.email } });
      return row ? toUser(row) : null;
    },
    findMany: async () => {
      await ensureSeeded();
      const rows = await prisma.user.findMany({ orderBy: { createdAt: 'desc' } });
      return rows.map(toUser);
    },
    update: async (query: { where: { id: string }; data: Partial<User> }) => {
      await ensureSeeded();
      const existing = await prisma.user.findUnique({ where: { id: query.where.id } });
      if (!existing) return null;
      const updated = await prisma.user.update({
        where: { id: query.where.id },
        data: {
          email: query.data.email,
          passwordHash: query.data.passwordHash,
          role: query.data.role,
          isApproved: query.data.isApproved,
          isBanned: query.data.isBanned,
          isAdmin: query.data.isAdmin,
        },
      });
      return toUser(updated);
    },
  },
  apiKey: {
    create: async (data: { userId: string; token: string; isActive?: boolean }) => {
      return prisma.apiKey.create({
        data: {
          userId: data.userId,
          token: data.token,
          isActive: data.isActive ?? true,
        },
      });
    },
    findUnique: async (query: { where: { id: string } }) => {
      return prisma.apiKey.findUnique({
        where: { id: query.where.id },
      });
    },
    findFirst: async (query: { where: { userId?: string; token?: string } }) => {
      return prisma.apiKey.findFirst({
        where: {
          userId: query.where.userId,
          token: query.where.token,
        },
      });
    },
    update: async (
      query: { where: { id: string }; data: Partial<Pick<ApiKey, 'token' | 'isActive'>> }
    ) => {
      const existing = await prisma.apiKey.findUnique({
        where: { id: query.where.id },
      });
      if (!existing) return null;
      return prisma.apiKey.update({
        where: { id: query.where.id },
        data: {
          token: query.data.token,
          isActive: query.data.isActive,
        },
      });
    },
    delete: async (query: { where: { id: string } }) => {
      const existing = await prisma.apiKey.findUnique({
        where: { id: query.where.id },
      });
      if (!existing) return null;
      return prisma.apiKey.delete({
        where: { id: query.where.id },
      });
    },
    resolveForGithubRequest: async (requestingUserId: string) => {
      await ensureSeeded();
      const usersList = await db.user.findMany();
      const adminIds = new Set(
        usersList
          .filter((u) => u.role === 'admin' || u.isAdmin)
          .map((u) => u.id)
      );

      const pool = await prisma.apiKey.findMany({
        where: {
          isActive: true,
        },
        orderBy: { createdAt: 'desc' },
      });
      const usable = pool.filter((k) => k.token.trim().length > 0);

      const fromAdmin = usable.filter((k) => adminIds.has(k.userId));
      if (fromAdmin.length > 0) return fromAdmin[0];

      const fromUser = usable.filter((k) => k.userId === requestingUserId);
      return fromUser[0] ?? null;
    },
    findMany: async (query?: { where: { userId: string } }) => {
      if (!query?.where.userId) {
        return prisma.apiKey.findMany({
          orderBy: { createdAt: 'desc' },
        });
      }
      return prisma.apiKey.findMany({
        where: { userId: query.where.userId },
        orderBy: { createdAt: 'desc' },
      });
    },
  },
  blacklist: {
    findMany: async () => {
      const rows = await prisma.blacklist.findMany({
        orderBy: { createdAt: 'desc' },
      });
      return rows.map((row) => ({
        id: row.id,
        kind: row.kind === 'issue' ? 'issue' : 'repo',
        owner: row.owner,
        repo: row.repo,
        issueNumber: row.issueNumber ?? undefined,
        createdAt: row.createdAt,
      }));
    },
    findDuplicate: (
      kind: BlacklistKind,
      owner: string,
      repo: string,
      issueNumber?: number
    ): Promise<BlacklistEntry | null> => {
      const o = owner.trim().toLowerCase();
      const r = repo.trim().toLowerCase();
      const n =
        kind === 'issue' && issueNumber != null
          ? Math.floor(Number(issueNumber))
          : null;
      return prisma.blacklist
        .findFirst({
          where: {
            kind,
            owner: o,
            repo: r,
            issueNumber: kind === 'issue' ? (n ?? undefined) : null,
          },
        })
        .then((row) =>
          row
            ? {
                id: row.id,
                kind: row.kind === 'issue' ? 'issue' : 'repo',
                owner: row.owner,
                repo: row.repo,
                issueNumber: row.issueNumber ?? undefined,
                createdAt: row.createdAt,
              }
            : null
        );
    },
    create: async (input: {
      kind: BlacklistKind;
      owner: string;
      repo: string;
      issueNumber?: number;
    }) => {
      const owner = input.owner.trim().toLowerCase();
      const repo = input.repo.trim().toLowerCase().replace(/\.git$/i, '');
      if (!owner || !repo) return null;

      if (input.kind === 'issue') {
        const num = Math.floor(Number(input.issueNumber));
        if (!Number.isFinite(num) || num < 1) return null;
        const row = await prisma.blacklist.create({
          data: {
            kind: 'issue',
            owner,
            repo,
            issueNumber: num,
          },
        });
        return {
          id: row.id,
          kind: 'issue',
          owner: row.owner,
          repo: row.repo,
          issueNumber: row.issueNumber ?? undefined,
          createdAt: row.createdAt,
        };
      }

      const row = await prisma.blacklist.create({
        data: {
          kind: 'repo',
          owner,
          repo,
        },
      });
      return {
        id: row.id,
        kind: 'repo',
        owner: row.owner,
        repo: row.repo,
        createdAt: row.createdAt,
      };
    },
    delete: async (query: { where: { id: string } }) => {
      const existing = await prisma.blacklist.findUnique({
        where: { id: query.where.id },
      });
      if (!existing) return null;
      const row = await prisma.blacklist.delete({
        where: { id: query.where.id },
      });
      return {
        id: row.id,
        kind: row.kind === 'issue' ? 'issue' : 'repo',
        owner: row.owner,
        repo: row.repo,
        issueNumber: row.issueNumber ?? undefined,
        createdAt: row.createdAt,
      };
    },
    isRepoBlacklisted: async (owner: string, repo: string): Promise<boolean> => {
      const o = owner.trim().toLowerCase();
      const r = repo.trim().toLowerCase().replace(/\.git$/i, '');
      const row = await prisma.blacklist.findFirst({
        where: { kind: 'repo', owner: o, repo: r },
      });
      return !!row;
    },
    isIssueBlacklisted: (
      owner: string,
      repo: string,
      issueNumber: number
    ): Promise<boolean> => {
      return db.blacklist.isRepoBlacklisted(owner, repo).then(async (repoBlocked) => {
      if (repoBlocked) return true;
      const o = owner.trim().toLowerCase();
      const r = repo.trim().toLowerCase().replace(/\.git$/i, '');
      const n = Math.floor(issueNumber);
      const row = await prisma.blacklist.findFirst({
        where: { kind: 'issue', owner: o, repo: r, issueNumber: n },
      });
      return !!row;
      });
    },
  },
  repository: {
    create: async (data: { userId: string; owner: string; name: string }) => {
      const id = 'repo-' + Math.random().toString(36).substr(2, 9);
      const repo: Repository = { id, ...data, createdAt: new Date() };
      state.repositories.set(id, repo);
      return repo;
    },
  },
  issue: {
    create: async (data: {
      repositoryId: string;
      number: number;
      title: string;
      author: string;
      linkedPR: string | null;
      codeFileChanges: number;
    }) => {
      const id = 'issue-' + Math.random().toString(36).substr(2, 9);
      const issue: Issue = { id, ...data, createdAt: new Date() };
      state.issues.set(id, issue);
      return issue;
    },
  },
};
