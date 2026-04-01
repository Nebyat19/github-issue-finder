// Simple in-memory database for development (optional JSON persistence)
import fs from 'fs';
import path from 'path';
import { config } from '@/lib/config';
import bcrypt from 'bcryptjs';

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
  apiKeys: Map<string, ApiKey>;
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
    apiKeys: new Map<string, ApiKey>(),
    blacklist: new Map<string, BlacklistEntry>(),
    repositories: new Map<string, Repository>(),
    issues: new Map<string, Issue>(),
  });

if (!(state as { blacklist?: Map<string, BlacklistEntry> }).blacklist) {
  (state as { blacklist: Map<string, BlacklistEntry> }).blacklist = new Map();
}

function getPersistPath(): string {
  const override = process.env.ISSUE_FINDER_DB_PATH?.trim();
  if (override) return override;
  return path.join(process.cwd(), '.data', 'issue-finder-db.json');
}

function persistState(): void {
  if (typeof window !== 'undefined') return;

  try {
    const filePath = getPersistPath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const payload = {
      users: Array.from(state.users.entries()).map(([id, u]) => [
        id,
        { ...u, createdAt: u.createdAt.toISOString() },
      ]),
      apiKeys: Array.from(state.apiKeys.entries()).map(([id, k]) => [
        id,
        { ...k, createdAt: k.createdAt.toISOString() },
      ]),
      blacklist: Array.from(state.blacklist.entries()).map(([id, b]) => [
        id,
        {
          ...b,
          createdAt: b.createdAt.toISOString(),
        },
      ]),
    };
    fs.writeFileSync(filePath, JSON.stringify(payload), 'utf8');
  } catch (err) {
    console.error('[issue-finder-db] Failed to persist state', err);
  }
}

function loadPersistedState(): void {
  if (typeof window !== 'undefined') return;

  try {
    const filePath = getPersistPath();
    if (!fs.existsSync(filePath)) return;

    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw) return;

    const data = JSON.parse(raw) as {
      users?: [string, Record<string, unknown>][];
      apiKeys?: [string, Record<string, unknown>][];
      blacklist?: [string, Record<string, unknown>][];
    };

    const nextUsers = new Map<string, User>();
    const nextKeys = new Map<string, ApiKey>();
    const nextBlacklist = new Map<string, BlacklistEntry>();

    for (const [id, row] of data.users ?? []) {
      const role = row.role === 'admin' ? 'admin' : 'user';
      nextUsers.set(id, {
        id: String(row.id ?? id),
        email: String(row.email ?? ''),
        passwordHash: String(row.passwordHash ?? ''),
        role,
        isApproved: Boolean(row.isApproved),
        isBanned: Boolean(row.isBanned),
        isAdmin: Boolean(row.isAdmin ?? role === 'admin'),
        createdAt: new Date(String(row.createdAt ?? Date.now())),
      });
    }

    for (const [id, row] of data.apiKeys ?? []) {
      nextKeys.set(id, {
        id: String(row.id ?? id),
        userId: String(row.userId ?? ''),
        token: String(row.token ?? ''),
        isActive: row.isActive !== false,
        createdAt: new Date(String(row.createdAt ?? Date.now())),
      });
    }

    for (const [id, row] of data.blacklist ?? []) {
      const kind = row.kind === 'issue' ? 'issue' : 'repo';
      const issueNumber = row.issueNumber;
      nextBlacklist.set(id, {
        id: String(row.id ?? id),
        kind,
        owner: String(row.owner ?? '').toLowerCase(),
        repo: String(row.repo ?? '').toLowerCase(),
        issueNumber:
          kind === 'issue' && issueNumber != null && Number.isFinite(Number(issueNumber))
            ? Math.floor(Number(issueNumber))
            : undefined,
        createdAt: new Date(String(row.createdAt ?? Date.now())),
      });
    }

    state.users.clear();
    state.apiKeys.clear();
    state.blacklist.clear();
    for (const [id, user] of nextUsers) state.users.set(id, user);
    for (const [id, key] of nextKeys) state.apiKeys.set(id, key);
    for (const [id, b] of nextBlacklist) state.blacklist.set(id, b);
  } catch (err) {
    console.error('[issue-finder-db] Failed to load persisted state', err);
  }
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
      const id = 'key-' + Math.random().toString(36).substr(2, 9);
      const key: ApiKey = {
        id,
        userId: data.userId,
        token: data.token,
        isActive: data.isActive ?? true,
        createdAt: new Date(),
      };
      state.apiKeys.set(id, key);
      persistState();
      return key;
    },
    findUnique: async (query: { where: { id: string } }) => {
      return state.apiKeys.get(query.where.id) ?? null;
    },
    findFirst: async (query: { where: { userId?: string; token?: string } }) => {
      for (const key of state.apiKeys.values()) {
        const userIdMatch =
          query.where.userId === undefined || key.userId === query.where.userId;
        const tokenMatch =
          query.where.token === undefined || key.token === query.where.token;
        if (userIdMatch && tokenMatch) {
          return key;
        }
      }
      return null;
    },
    update: async (
      query: { where: { id: string }; data: Partial<Pick<ApiKey, 'token' | 'isActive'>> }
    ) => {
      const key = state.apiKeys.get(query.where.id);
      if (!key) return null;
      const updated = { ...key, ...query.data };
      state.apiKeys.set(query.where.id, updated);
      persistState();
      return updated;
    },
    delete: async (query: { where: { id: string } }) => {
      const key = state.apiKeys.get(query.where.id);
      if (!key) return null;
      state.apiKeys.delete(query.where.id);
      persistState();
      return key;
    },
    resolveForGithubRequest: async (requestingUserId: string) => {
      const usersList = Array.from(state.users.values());
      const adminIds = new Set(
        usersList
          .filter((u) => u.role === 'admin' || u.isAdmin)
          .map((u) => u.id)
      );

      const usable = (k: ApiKey) =>
        k.token.trim().length > 0 && k.isActive !== false;

      const pool = Array.from(state.apiKeys.values()).filter(usable);

      const fromAdmin = pool
        .filter((k) => adminIds.has(k.userId))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      if (fromAdmin.length > 0) return fromAdmin[0];

      const fromUser = pool
        .filter((k) => k.userId === requestingUserId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return fromUser[0] ?? null;
    },
    findMany: async (query?: { where: { userId: string } }) => {
      if (!query?.where.userId) return Array.from(state.apiKeys.values());
      return Array.from(state.apiKeys.values()).filter(
        (k) => k.userId === query.where.userId
      );
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
