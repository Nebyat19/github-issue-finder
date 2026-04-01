// Simple in-memory database for development (API keys persisted in SQLite)
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
  users: Map<string, User>;
  blacklist: Map<string, BlacklistEntry>;
  repositories: Map<string, Repository>;
  issues: Map<string, Issue>;
}

const globalDb = globalThis as typeof globalThis & {
  __issueFinderInMemoryDb?: InMemoryState;
};

const state: InMemoryState =
  globalDb.__issueFinderInMemoryDb ??
  (globalDb.__issueFinderInMemoryDb = {
    users: new Map<string, User>(),
    blacklist: new Map<string, BlacklistEntry>(),
    repositories: new Map<string, Repository>(),
    issues: new Map<string, Issue>(),
  });

if (!(state as { blacklist?: Map<string, BlacklistEntry> }).blacklist) {
  (state as { blacklist: Map<string, BlacklistEntry> }).blacklist = new Map();
}

function persistState(): void {
  // JSON persistence removed. Keep no-op for backward compatibility.
}

function loadPersistedState(): void {
  // JSON persistence removed.
}

loadPersistedState();

// Create default admin user for testing (skipped if already loaded from disk)
const defaultAdminId = config.seed.adminId;
const defaultAdminEmail = config.seed.adminEmail;
const defaultAdminHash =
  config.seed.adminPasswordHash ||
  (config.seed.adminPassword
    ? bcrypt.hashSync(config.seed.adminPassword, 10)
    : '');

if (defaultAdminEmail && defaultAdminHash && !state.users.has(defaultAdminId)) {
  state.users.set(defaultAdminId, {
    id: defaultAdminId,
    email: defaultAdminEmail,
    passwordHash: defaultAdminHash,
    role: 'admin',
    isApproved: true,
    isBanned: false,
    isAdmin: true,
    createdAt: new Date(),
  });
  persistState();
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
      const id = 'user-' + Math.random().toString(36).substr(2, 9);
      const role = input.data.role ?? (input.data.isAdmin ? 'admin' : 'user');
      const user: User = {
        id,
        email: input.data.email,
        passwordHash: input.data.passwordHash,
        role,
        isApproved: input.data.isApproved ?? false,
        isBanned: input.data.isBanned ?? false,
        isAdmin: role === 'admin',
        createdAt: new Date(),
      };
      state.users.set(id, user);
      persistState();
      return user;
    },
    findUnique: async (query: { where: { email?: string; id?: string } }) => {
      if (query.where.id) {
        return state.users.get(query.where.id) ?? null;
      }

      if (!query.where.email) {
        return null;
      }

      for (const user of state.users.values()) {
        if (user.email === query.where.email) {
          return user;
        }
      }
      return null;
    },
    findMany: async () => {
      return Array.from(state.users.values());
    },
    update: async (query: { where: { id: string }; data: Partial<User> }) => {
      const user = state.users.get(query.where.id);
      if (!user) return null;
      const updated = { ...user, ...query.data };
      state.users.set(query.where.id, updated);
      persistState();
      return updated;
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
      const usersList = Array.from(state.users.values());
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
      return Array.from(state.blacklist.values()).sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
      );
    },
    findDuplicate: (
      kind: BlacklistKind,
      owner: string,
      repo: string,
      issueNumber?: number
    ): BlacklistEntry | null => {
      const o = owner.trim().toLowerCase();
      const r = repo.trim().toLowerCase();
      const n =
        kind === 'issue' && issueNumber != null
          ? Math.floor(Number(issueNumber))
          : null;
      for (const e of state.blacklist.values()) {
        if (e.kind !== kind || e.owner !== o || e.repo !== r) continue;
        if (kind === 'repo') return e;
        if (n != null && e.issueNumber === n) return e;
      }
      return null;
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
        const id = 'bl-' + Math.random().toString(36).substring(2, 11);
        const entry: BlacklistEntry = {
          id,
          kind: 'issue',
          owner,
          repo,
          issueNumber: num,
          createdAt: new Date(),
        };
        state.blacklist.set(id, entry);
        persistState();
        return entry;
      }

      const id = 'bl-' + Math.random().toString(36).substring(2, 11);
      const entry: BlacklistEntry = {
        id,
        kind: 'repo',
        owner,
        repo,
        createdAt: new Date(),
      };
      state.blacklist.set(id, entry);
      persistState();
      return entry;
    },
    delete: async (query: { where: { id: string } }) => {
      const row = state.blacklist.get(query.where.id);
      if (!row) return null;
      state.blacklist.delete(query.where.id);
      persistState();
      return row;
    },
    isRepoBlacklisted: (owner: string, repo: string): boolean => {
      const o = owner.trim().toLowerCase();
      const r = repo.trim().toLowerCase().replace(/\.git$/i, '');
      for (const e of state.blacklist.values()) {
        if (e.kind === 'repo' && e.owner === o && e.repo === r) return true;
      }
      return false;
    },
    isIssueBlacklisted: (
      owner: string,
      repo: string,
      issueNumber: number
    ): boolean => {
      if (db.blacklist.isRepoBlacklisted(owner, repo)) return true;
      const o = owner.trim().toLowerCase();
      const r = repo.trim().toLowerCase().replace(/\.git$/i, '');
      const n = Math.floor(issueNumber);
      for (const e of state.blacklist.values()) {
        if (
          e.kind === 'issue' &&
          e.owner === o &&
          e.repo === r &&
          e.issueNumber === n
        ) {
          return true;
        }
      }
      return false;
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
