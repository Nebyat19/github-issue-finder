'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import {
  Ban,
  Check,
  Copy,
  ExternalLink,
  FileCode2,
  GitPullRequest,
  LayoutGrid,
  LogOut,
  Search,
  ShieldAlert,
  Star,
  Activity,
} from 'lucide-react';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import Link from 'next/link';

interface FilesChangedBreakdown {
  total: number;
  code: number;
  docs: number;
  additions: number;
  deletions: number;
}

interface Issue {
  id: number;
  number: number;
  title: string;
  description: string;
  author: string;
  url: string;
  linkedPR?: string;
  commitHash?: string;
  filesChanged: FilesChangedBreakdown;
  labels: string[];
  createdAt: string;
  updatedAt: string;
  owner: string;
  repo: string;
  isBlacklisted?: boolean;
}

interface RepoInfo {
  fullName: string;
  url: string;
  description: string | null;
  stars: number;
  forks: number;
  closedIssues: number;
  language: string | null;
  defaultBranch: string;
}

interface BlacklistEntryRow {
  id: string;
  kind: 'repo' | 'issue';
  owner: string;
  repo: string;
  issueNumber?: number;
  label: string;
  createdAt: string;
}

interface RepoFinderResult {
  id: number;
  fullName: string;
  url: string;
  description: string | null;
  stars: number;
  forks: number;
  closedIssues: number;
  language: string | null;
  defaultBranch: string;
  updatedAt: string;
  isBlacklisted: boolean;
}

const REPO_FINDER_LANGUAGES = [
  'TypeScript',
  'JavaScript',
  'Python',
  'Java',
  'Go',
  'Rust',
  'C#',
  'C++',
  'C',
  'PHP',
  'Ruby',
  'Swift',
  'Kotlin',
  'Dart',
  'Scala',
  'Shell',
  'HTML',
  'CSS',
];

/** Match server blacklist rules: repo entry blocks all issues in that repo. */
function issueMatchesBlacklist(
  issue: Pick<Issue, 'owner' | 'repo' | 'number'>,
  entries: BlacklistEntryRow[]
): boolean {
  const o = issue.owner.trim().toLowerCase();
  const r = issue.repo.trim().toLowerCase().replace(/\.git$/i, '');
  for (const e of entries) {
    if (e.owner !== o || e.repo !== r) continue;
    if (e.kind === 'repo') return true;
    if (e.kind === 'issue' && e.issueNumber === issue.number) return true;
  }
  return false;
}

function repoMatchesBlacklist(
  repoRef: Pick<Issue, 'owner' | 'repo'>,
  entries: BlacklistEntryRow[]
): boolean {
  const o = repoRef.owner.trim().toLowerCase();
  const r = repoRef.repo.trim().toLowerCase().replace(/\.git$/i, '');
  return entries.some((e) => e.kind === 'repo' && e.owner === o && e.repo === r);
}

function parseFinderInt(raw: string, min: number, max: number): number | null {
  if (!raw.trim()) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const v = Math.floor(n);
  if (v < min || v > max) return null;
  return v;
}

export default function DashboardPage() {
  const [tab, setTab] = useState('finder');
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [issueUrl, setIssueUrl] = useState('');
  const [issues, setIssues] = useState<Issue[]>([]);
  const [lookupIssue, setLookupIssue] = useState<Issue | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [snapshotCommitHash, setSnapshotCommitHash] = useState<string | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [lookupSnapshotCommitHash, setLookupSnapshotCommitHash] = useState<string | null>(null);
  const [lookupSnapshotLoading, setLookupSnapshotLoading] = useState(false);
  const [lookupRepoInfoLoading, setLookupRepoInfoLoading] = useState(false);
  const [copiedField, setCopiedField] = useState<'hash' | 'checkout' | null>(null);
  const [repoInfo, setRepoInfo] = useState<RepoInfo | null>(null);
  const [maxAnalyzeIssues, setMaxAnalyzeIssues] = useState('80');
  const [maxIssuePages, setMaxIssuePages] = useState('20');
  const [maxPullPages, setMaxPullPages] = useState('20');
  const [minCodeFileChanges, setMinCodeFileChanges] = useState('4');
  const [finderMeta, setFinderMeta] = useState<{
    warning?: string;
    appliedLimits?: {
      maxAnalyzeIssues: number;
      maxIssuePages: number;
      maxPullPages: number;
      minCodeFileChanges: number;
    };
  } | null>(null);
  const [hasFetchedFinder, setHasFetchedFinder] = useState(false);
  const [finderLoading, setFinderLoading] = useState(false);
  const [repoInfoLoading, setRepoInfoLoading] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isMounted, setIsMounted] = useState(false);
  const [canViewAdmin, setCanViewAdmin] = useState(false);
  const [blacklistEntries, setBlacklistEntries] = useState<BlacklistEntryRow[]>([]);
  const [manualRepoBlacklist, setManualRepoBlacklist] = useState('');
  const [manualIssueBlacklist, setManualIssueBlacklist] = useState('');
  const [blacklistError, setBlacklistError] = useState('');
  const [blacklistBusyId, setBlacklistBusyId] = useState<string | null>(null);
  const [repoBlockedForFetch, setRepoBlockedForFetch] = useState(false);
  const [repoFinderLanguage, setRepoFinderLanguage] = useState('Any');
  const [repoFinderMinStars, setRepoFinderMinStars] = useState('50');
  const [repoFinderMinIssues, setRepoFinderMinIssues] = useState('10');
  const [repoFinderResults, setRepoFinderResults] = useState<RepoFinderResult[]>([]);
  const [repoFinderLoading, setRepoFinderLoading] = useState(false);
  const [selectedRepoResult, setSelectedRepoResult] = useState<RepoFinderResult | null>(null);
  const [copiedRepoId, setCopiedRepoId] = useState<number | null>(null);
  const router = useRouter();
  const finderScanLimits = useMemo(() => {
    const maxAnalyze = parseFinderInt(maxAnalyzeIssues, 1, 500);
    const issuePages = parseFinderInt(maxIssuePages, 1, 20);
    const pullPages = parseFinderInt(maxPullPages, 1, 20);
    const minCodeFiles = parseFinderInt(minCodeFileChanges, 0, 1000);
    if (
      maxAnalyze === null ||
      issuePages === null ||
      pullPages === null ||
      minCodeFiles === null
    ) {
      return null;
    }
    return {
      maxAnalyzeIssues: maxAnalyze,
      maxIssuePages: issuePages,
      maxPullPages: pullPages,
      minCodeFileChanges: minCodeFiles,
    };
  }, [maxAnalyzeIssues, maxIssuePages, maxPullPages, minCodeFileChanges]);
  const isFinderDisabled =
    finderLoading || !owner.trim() || !repo.trim() || finderScanLimits === null;
  const isLookupDisabled = lookupLoading || !issueUrl.trim();
  const isRepoFinderDisabled = repoFinderLoading;

  const getAuthToken = (): string | null => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('token');
  };

  const loadBlacklist = async (): Promise<BlacklistEntryRow[]> => {
    const token = getAuthToken();
    if (!token) return [];
    try {
      const res = await fetch('/api/blacklist', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as { entries?: BlacklistEntryRow[]; error?: string };
      if (res.ok) {
        const list = data.entries || [];
        setBlacklistEntries(list);
        return list;
      }
    } catch {
      /* ignore */
    }
    return [];
  };

  const applyBlacklistToIssueState = (entries: BlacklistEntryRow[]) => {
    setIssues((prev) =>
      prev.map((i) => ({
        ...i,
        isBlacklisted: issueMatchesBlacklist(i, entries),
      }))
    );
    setSelectedIssue((s) =>
      s ? { ...s, isBlacklisted: issueMatchesBlacklist(s, entries) } : null
    );
    setLookupIssue((l) =>
      l ? { ...l, isBlacklisted: issueMatchesBlacklist(l, entries) } : null
    );
  };

  useEffect(() => {
    setIsMounted(true);
    const token = localStorage.getItem('token');
    if (!token) {
      router.replace('/login');
      return;
    }

    const checkAdminAccess = async () => {
      try {
        const response = await fetch('/api/admin/users', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        setCanViewAdmin(response.ok);
      } catch {
        setCanViewAdmin(false);
      }
    };

    void checkAdminAccess();
    void loadBlacklist();
  }, [router]);

  useEffect(() => {
    if (tab !== 'blacklist') return;
    void loadBlacklist();
  }, [tab]);

  const postBlacklist = async (body: {
    kind: 'repo' | 'issue';
    url?: string;
    owner?: string;
    repo?: string;
    issueNumber?: number;
  }): Promise<BlacklistEntryRow[] | false> => {
    const token = getAuthToken();
    if (!token) {
      router.replace('/login');
      return false;
    }
    setBlacklistError('');
    setBlacklistBusyId('post');
    try {
      const res = await fetch('/api/blacklist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { error?: string };
      if (res.status === 409) {
        setBlacklistError(data.error || 'Already blacklisted');
        return false;
      }
      if (!res.ok) {
        setBlacklistError(data.error || 'Failed to update blacklist');
        return false;
      }
      return await loadBlacklist();
    } catch {
      setBlacklistError('Failed to update blacklist');
      return false;
    } finally {
      setBlacklistBusyId(null);
    }
  };

  const handleBlacklistCurrentRepo = async () => {
    if (!owner.trim() || !repo.trim()) return;
    const entries = await postBlacklist({
      kind: 'repo',
      url: `https://github.com/${owner.trim()}/${repo.trim()}`,
    });
    if (entries !== false) {
      setManualRepoBlacklist('');
      setIssues([]);
      setSelectedIssue(null);
      setHasFetchedFinder(true);
      setFinderMeta({
        warning:
          'This repository is now blacklisted. Remove it from the Blacklist tab to fetch issues again.',
      });
    }
  };

  const handleBlacklistIssue = async (issue: Issue) => {
    const entries = await postBlacklist({
      kind: 'issue',
      url: issue.url,
    });
    if (entries !== false) {
      applyBlacklistToIssueState(entries);
    }
  };

  const handleManualRepoBlacklist = async (e: React.FormEvent) => {
    e.preventDefault();
    const entries = await postBlacklist({ kind: 'repo', url: manualRepoBlacklist.trim() });
    if (entries !== false) setManualRepoBlacklist('');
  };

  const handleManualIssueBlacklist = async (e: React.FormEvent) => {
    e.preventDefault();
    const entries = await postBlacklist({ kind: 'issue', url: manualIssueBlacklist.trim() });
    if (entries !== false) setManualIssueBlacklist('');
  };

  const handleRemoveBlacklist = async (id: string) => {
    const token = getAuthToken();
    if (!token) {
      router.replace('/login');
      return;
    }
    setBlacklistError('');
    setBlacklistBusyId(id);
    try {
      const res = await fetch(`/api/blacklist/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setBlacklistError(data.error || 'Failed to remove');
        return;
      }
      const entries = await loadBlacklist();
      applyBlacklistToIssueState(entries);
    } catch {
      setBlacklistError('Failed to remove');
    } finally {
      setBlacklistBusyId(null);
    }
  };

  const handleFetchIssues = async (e: React.FormEvent) => {
    await runFetchIssues(false, e);
  };

  const runFetchIssues = async (
    forceFetchBlacklistedRepo: boolean,
    e?: React.FormEvent
  ) => {
    if (e) e.preventDefault();
    setError('');
    setFinderLoading(true);
    setLookupIssue(null);
    setSelectedIssue(null);
    setRepoInfo(null);
    setHasFetchedFinder(false);
    setFinderMeta(null);
    setRepoBlockedForFetch(false);

    try {
      const token = localStorage.getItem('token');
      if (!token) {
        router.replace('/login');
        return;
      }

      if (!finderScanLimits) {
        setError('Enter valid scan limits (integers in range).');
        return;
      }

      const response = await fetch('/api/github/issues', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          owner: owner.trim(),
          repo: repo.trim(),
          forceFetchBlacklistedRepo,
          ...finderScanLimits,
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        code?: string;
        issues?: Issue[];
        warning?: string;
        repoBlacklisted?: boolean;
        appliedLimits?: {
          maxAnalyzeIssues: number;
          maxIssuePages: number;
          maxPullPages: number;
          minCodeFileChanges: number;
        };
      };

      if (!response.ok) {
        if (response.status === 409 && data.code === 'REPO_BLACKLISTED') {
          setRepoBlockedForFetch(true);
        }
        setError(data.error || 'Failed to fetch issues');
        return;
      }

      setFinderMeta({
        warning: data.warning,
        appliedLimits: data.appliedLimits,
      });
      setRepoBlockedForFetch(false);
      const entries = await loadBlacklist();
      setIssues(
        (data.issues || []).map((i) => ({
          ...i,
          isBlacklisted: issueMatchesBlacklist(i, entries),
        }))
      );
      setHasFetchedFinder(true);
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setFinderLoading(false);
    }
  };

  const handleFetchRepoInfo = async () => {
    setError('');
    setRepoInfoLoading(true);
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        router.replace('/login');
        return;
      }

      const response = await fetch('/api/github/repo-info', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          owner: owner.trim(),
          repo: repo.trim(),
        }),
      });
      const data = (await response.json()) as { error?: string; repository?: RepoInfo };
      if (!response.ok) {
        setError(data.error || 'Failed to fetch repository info');
        return;
      }
      setRepoInfo(data.repository || null);
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setRepoInfoLoading(false);
    }
  };

  const handleIssueLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLookupLoading(true);
    setLookupIssue(null);

    try {
      const token = localStorage.getItem('token');
      if (!token) {
        router.replace('/login');
        return;
      }

      const response = await fetch('/api/github/issue-lookup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          issueUrl: issueUrl.trim(),
        }),
      });

      const data = (await response.json()) as { error?: string; issue?: Issue };
      if (!response.ok) {
        setError(data.error || 'Failed to lookup issue');
        return;
      }

      const raw = data.issue;
      if (!raw) {
        setLookupIssue(null);
        setSelectedIssue(null);
        return;
      }
      const entries = await loadBlacklist();
      const withFlag = {
        ...raw,
        isBlacklisted: issueMatchesBlacklist(raw, entries),
      };
      setLookupIssue(withFlag);
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setLookupLoading(false);
    }
  };

  const handleRepoFinder = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setRepoFinderLoading(true);
    setSelectedRepoResult(null);
    try {
      const token = getAuthToken();
      if (!token) {
        router.replace('/login');
        return;
      }
      const response = await fetch('/api/github/repo-finder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          language: repoFinderLanguage === 'Any' ? '' : repoFinderLanguage.trim(),
          minStars: Number(repoFinderMinStars || '0'),
          minClosedIssues: Number(repoFinderMinIssues || '0'),
          maxResults: 50,
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        repositories?: RepoFinderResult[];
      };

      if (!response.ok) {
        setError(data.error || 'Failed to find repositories');
        return;
      }

      setRepoFinderResults(data.repositories || []);
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setRepoFinderLoading(false);
    }
  };

  const handleCopyRepoUrl = async (repoResult: RepoFinderResult) => {
    try {
      await navigator.clipboard.writeText(repoResult.url);
      setCopiedRepoId(repoResult.id);
      setTimeout(() => setCopiedRepoId(null), 1200);
    } catch {
      setCopiedRepoId(null);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    router.replace('/login');
  };

  const filteredIssues = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return issues;

    return issues.filter(
      (issue) =>
        issue.title.toLowerCase().includes(term) ||
        issue.author.toLowerCase().includes(term)
    );
  }, [issues, searchTerm]);

  const finderStats = useMemo(() => {
    const blacklisted = issues.filter((i) => i.isBlacklisted).length;
    const withPr = issues.filter((i) => Boolean(i.linkedPR)).length;
    const codeFiles = issues.reduce((sum, i) => sum + i.filesChanged.code, 0);
    return {
      total: issues.length,
      blacklisted,
      withPr,
      codeFiles,
    };
  }, [issues]);
  const lookupRepoBlacklisted = useMemo(() => {
    if (!lookupIssue) return false;
    return repoMatchesBlacklist(lookupIssue, blacklistEntries);
  }, [lookupIssue, blacklistEntries]);

  useEffect(() => {
    const loadSnapshotCommit = async () => {
      if (!selectedIssue?.owner || !selectedIssue?.repo || !selectedIssue?.createdAt) {
        setSnapshotCommitHash(null);
        return;
      }

      try {
        const token = localStorage.getItem('token');
        if (!token) return;
        setSnapshotLoading(true);

        const response = await fetch('/api/github/issue-snapshot-commit', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            owner: selectedIssue.owner,
            repo: selectedIssue.repo,
            linkedPR: selectedIssue.linkedPR,
            fallbackIssueCreatedAt: selectedIssue.createdAt,
          }),
        });

        const data = (await response.json()) as { commitHash?: string | null };
        if (!response.ok) {
          setSnapshotCommitHash(null);
          return;
        }
        setSnapshotCommitHash(data.commitHash ?? null);
      } catch {
        setSnapshotCommitHash(null);
      } finally {
        setSnapshotLoading(false);
      }
    };

    setCopiedField(null);
    loadSnapshotCommit();
  }, [selectedIssue]);

  useEffect(() => {
    const loadLookupSnapshotCommit = async () => {
      if (!lookupIssue?.owner || !lookupIssue?.repo || !lookupIssue?.createdAt) {
        setLookupSnapshotCommitHash(null);
        return;
      }

      try {
        const token = localStorage.getItem('token');
        if (!token) return;
        setLookupSnapshotLoading(true);

        const response = await fetch('/api/github/issue-snapshot-commit', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            owner: lookupIssue.owner,
            repo: lookupIssue.repo,
            linkedPR: lookupIssue.linkedPR,
            fallbackIssueCreatedAt: lookupIssue.createdAt,
          }),
        });

        const data = (await response.json()) as { commitHash?: string | null };
        if (!response.ok) {
          setLookupSnapshotCommitHash(null);
          return;
        }
        setLookupSnapshotCommitHash(data.commitHash ?? null);
      } catch {
        setLookupSnapshotCommitHash(null);
      } finally {
        setLookupSnapshotLoading(false);
      }
    };

    setCopiedField(null);
    void loadLookupSnapshotCommit();
  }, [lookupIssue]);

  const copyText = async (text: string, field: 'hash' | 'checkout') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    } catch {
      setCopiedField(null);
    }
  };

  const handleLookupShowRepoInfo = async () => {
    if (!lookupIssue) return;
    setError('');
    setLookupRepoInfoLoading(true);
    try {
      const token = getAuthToken();
      if (!token) {
        router.replace('/login');
        return;
      }
      const response = await fetch('/api/github/repo-info', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          owner: lookupIssue.owner.trim(),
          repo: lookupIssue.repo.trim(),
        }),
      });
      const data = (await response.json()) as { error?: string; repository?: RepoInfo };
      if (!response.ok) {
        setError(data.error || 'Failed to fetch repository info');
        return;
      }
      setRepoInfo(data.repository || null);
      setTab('finder');
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setLookupRepoInfoLoading(false);
    }
  };

  if (!isMounted) {
    return <div className="app-shell" />;
  }

  return (
    <div className="app-shell">
      {/* Header */}
      <header className="app-header">
        <div className="mx-auto w-full px-4 py-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: 'linear-gradient(135deg, oklch(0.55 0.22 275), oklch(0.6 0.2 290))' }}>
              <LayoutGrid className="h-4.5 w-4.5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-foreground">
                GitHub Issues Analyzer
              </h1>
              <p className="text-xs text-muted-foreground -mt-0.5">
                Analyze closed issues linked to code-heavy PRs
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {canViewAdmin && (
              <Link
                href="/admin"
                className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              >
                <ShieldAlert className="h-4 w-4" />
                Admin
              </Link>
            )}
            <Button
              onClick={handleLogout}
              variant="outline"
              size="sm"
              className="border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/50"
            >
              <LogOut className="mr-1.5 h-3.5 w-3.5" />
              Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full px-4 py-6 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          <div className="stat-card animate-fade-in" style={{ '--stat-accent': 'oklch(0.65 0.2 275)', '--stat-icon-bg': 'oklch(0.65 0.2 275 / 0.12)' } as React.CSSProperties}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Loaded Issues</p>
                <p className="mt-2 text-3xl font-bold text-foreground">{finderStats.total}</p>
              </div>
              <div className="stat-icon">
                <Activity className="h-5 w-5" style={{ color: 'oklch(0.65 0.2 275)' }} />
              </div>
            </div>
          </div>
          <div className="stat-card animate-fade-in-delay-1" style={{ '--stat-accent': 'oklch(0.6 0.18 200)', '--stat-icon-bg': 'oklch(0.6 0.18 200 / 0.12)' } as React.CSSProperties}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">With Linked PR</p>
                <p className="mt-2 text-3xl font-bold text-foreground">{finderStats.withPr}</p>
              </div>
              <div className="stat-icon">
                <GitPullRequest className="h-5 w-5" style={{ color: 'oklch(0.6 0.18 200)' }} />
              </div>
            </div>
          </div>
          <div className="stat-card animate-fade-in-delay-2" style={{ '--stat-accent': 'oklch(0.7 0.16 65)', '--stat-icon-bg': 'oklch(0.7 0.16 65 / 0.12)' } as React.CSSProperties}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Blacklisted</p>
                <p className="mt-2 text-3xl font-bold text-foreground">{finderStats.blacklisted}</p>
              </div>
              <div className="stat-icon">
                <Ban className="h-5 w-5" style={{ color: 'oklch(0.7 0.16 65)' }} />
              </div>
            </div>
          </div>
          <div className="stat-card animate-fade-in-delay-3" style={{ '--stat-accent': 'oklch(0.65 0.17 160)', '--stat-icon-bg': 'oklch(0.65 0.17 160 / 0.12)' } as React.CSSProperties}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Code Files Changed</p>
                <p className="mt-2 text-3xl font-bold text-foreground">{finderStats.codeFiles}</p>
              </div>
              <div className="stat-icon">
                <FileCode2 className="h-5 w-5" style={{ color: 'oklch(0.65 0.17 160)' }} />
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)] gap-6 items-start">
          <aside className="section-card p-3 lg:sticky lg:top-20">
            <p className="px-3 pb-3 pt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              Navigation
            </p>
            <div className="sidebar-nav">
              <button
                type="button"
                className="sidebar-nav-btn"
                data-active={tab === 'finder'}
                onClick={() => setTab('finder')}
              >
                <Search className="h-4 w-4" />
                Issue Finder
              </button>
              <button
                type="button"
                className="sidebar-nav-btn"
                data-active={tab === 'lookup'}
                onClick={() => setTab('lookup')}
              >
                <GitPullRequest className="h-4 w-4" />
                Issue Lookup
              </button>
              <button
                type="button"
                className="sidebar-nav-btn"
                data-active={tab === 'blacklist'}
                onClick={() => setTab('blacklist')}
              >
                <Ban className="h-4 w-4" />
                Blacklist
              </button>
              <button
                type="button"
                className="sidebar-nav-btn"
                data-active={tab === 'repo-finder'}
                onClick={() => setTab('repo-finder')}
              >
                <Star className="h-4 w-4" />
                Repo Finder
              </button>
            </div>
          </aside>

          <Tabs value={tab} onValueChange={setTab}>
          <TabsContent value="finder" className="mt-0">
            <div className="section-card mb-6 mt-4 animate-fade-in">
              <div className="p-6">
                <h2 className="text-base font-semibold text-foreground mb-4">Issue Finder</h2>
                <form onSubmit={handleFetchIssues} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="repo-url" className="block text-sm font-medium text-foreground mb-2">
                        Repository URL
                      </label>
                      <Input
                        id="repo-url"
                        placeholder="https://github.com/vercel/next.js"
                        value={owner && repo ? `https://github.com/${owner}/${repo}` : ''}
                        onChange={(e) => {
                          const value = e.target.value.trim();
                          try {
                            const url = new URL(value);
                            const parts = url.pathname.split('/').filter(Boolean);
                            setOwner(parts[0] || '');
                            setRepo(parts[1] || '');
                          } catch {
                            setOwner('');
                            setRepo('');
                          }
                        }}
                        required
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div>
                      <label
                        htmlFor="max-analyze-issues"
                        className="block text-sm font-medium text-foreground mb-2"
                      >
                        Max issues to analyze
                      </label>
                      <Input
                        id="max-analyze-issues"
                        type="number"
                        min={1}
                        max={500}
                        value={maxAnalyzeIssues}
                        onChange={(e) => setMaxAnalyzeIssues(e.target.value)}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="max-issue-pages"
                        className="block text-sm font-medium text-foreground mb-2"
                      >
                        Max issue pages
                      </label>
                      <Input
                        id="max-issue-pages"
                        type="number"
                        min={1}
                        max={20}
                        value={maxIssuePages}
                        onChange={(e) => setMaxIssuePages(e.target.value)}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="max-pull-pages"
                        className="block text-sm font-medium text-foreground mb-2"
                      >
                        Max PR pages
                      </label>
                      <Input
                        id="max-pull-pages"
                        type="number"
                        min={1}
                        max={20}
                        value={maxPullPages}
                        onChange={(e) => setMaxPullPages(e.target.value)}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="min-code-file-changes"
                        className="block text-sm font-medium text-foreground mb-2"
                      >
                        Min code files changed
                      </label>
                      <Input
                        id="min-code-file-changes"
                        type="number"
                        min={0}
                        max={1000}
                        value={minCodeFileChanges}
                        onChange={(e) => setMinCodeFileChanges(e.target.value)}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Uses the API key configured by admin to fetch closed issues and metadata.
                    Adjust how many closed issues and PR pages are scanned before &quot;Find Issues&quot;
                    (defaults match server env when unchanged). Min code files changed
                    filters by code files only, not total or docs files.
                  </p>
                  {finderMeta?.appliedLimits && (
                    <p className="text-xs text-muted-foreground" aria-live="polite">
                      Applied limits: analyze up to {finderMeta.appliedLimits.maxAnalyzeIssues} issues
                      after fetching {finderMeta.appliedLimits.maxIssuePages} issue page(s) and{' '}
                      {finderMeta.appliedLimits.maxPullPages} PR page(s), minimum{' '}
                      {finderMeta.appliedLimits.minCodeFileChanges} code file change(s).
                    </p>
                  )}
                  {finderMeta?.warning && (
                    <div
                      role="status"
                      aria-live="polite"
                      className="status-info flex items-start gap-2"
                    >
                      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                      {finderMeta.warning}
                    </div>
                  )}
                  {error && (
                    <div role="alert" aria-live="polite" className="status-error flex items-start gap-2">
                      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                      {error}
                    </div>
                  )}
                  {repoBlockedForFetch && (
                    <div
                      role="status"
                      aria-live="polite"
                      className="p-3 bg-amber-500/10 border border-amber-500/40 text-amber-700 dark:text-amber-400 text-sm rounded flex items-center justify-between gap-3"
                    >
                      <span>This repository is blacklisted.</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void runFetchIssues(true)}
                      >
                        Fetch it anyway
                      </Button>
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={isFinderDisabled}
                    className="btn-primary-gradient"
                  >
                    {finderLoading ? 'Fetching...' : 'Find Issues'}
                  </button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={repoInfoLoading || !owner.trim() || !repo.trim()}
                        onClick={handleFetchRepoInfo}
                        className="ml-2"
                      >
                        {repoInfoLoading ? 'Loading Repo Info...' : 'Show Repo Info'}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Fetch repository metadata for the current owner/repo.</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={isFinderDisabled || blacklistBusyId === 'post'}
                        onClick={() => void handleBlacklistCurrentRepo()}
                        className="ml-2 border-destructive/50 text-destructive hover:bg-destructive/10"
                      >
                        Blacklist this repo
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Blocks this repository across finder and lookup results.</TooltipContent>
                  </Tooltip>
                </form>
              </div>
            </div>

            {repoInfo && (
              <div className="section-card p-6 mb-6 animate-fade-in">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">Repository Info</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Snapshot of repository metadata
                    </p>
                  </div>
                  <a
                    href={repoInfo.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center rounded-lg border border-border/80 bg-card px-3 py-1.5 text-xs font-medium text-primary hover:bg-muted"
                  >
                    Open Repo
                  </a>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                  <div className="rounded-xl border border-border/70 bg-muted/35 p-3">
                    <p className="text-xs text-muted-foreground">Name</p>
                    <p className="mt-1 text-sm font-medium text-foreground break-all">{repoInfo.fullName}</p>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-muted/35 p-3">
                    <p className="text-xs text-muted-foreground">Language</p>
                    <p className="mt-1 text-sm font-medium text-foreground">{repoInfo.language || 'N/A'}</p>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-muted/35 p-3">
                    <p className="text-xs text-muted-foreground">Default Branch</p>
                    <p className="mt-1 text-sm font-medium text-foreground">{repoInfo.defaultBranch}</p>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-muted/35 p-3">
                    <p className="text-xs text-muted-foreground">Closed Issues</p>
                    <p className="mt-1 text-sm font-medium text-foreground">{repoInfo.closedIssues.toLocaleString()}</p>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-muted/35 p-3">
                    <p className="text-xs text-muted-foreground">Stars</p>
                    <p className="mt-1 text-sm font-medium text-foreground">{repoInfo.stars.toLocaleString()}</p>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-muted/35 p-3">
                    <p className="text-xs text-muted-foreground">Forks</p>
                    <p className="mt-1 text-sm font-medium text-foreground">{repoInfo.forks.toLocaleString()}</p>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-muted/35 p-3 md:col-span-2">
                    <p className="text-xs text-muted-foreground">Description</p>
                    <p className="mt-1 text-sm text-foreground leading-relaxed">
                      {repoInfo.description || 'N/A'}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {issues.length > 0 && (
              <>
                <div className="mb-4">
                  <Input
                    placeholder="Search by title or author..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="max-w-md"
                    aria-label="Search issues by title or author"
                  />
                </div>

                <div className="pro-table-wrapper animate-fade-in">
                  <div className="max-h-[420px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Issue #</TableHead>
                        <TableHead>Title</TableHead>
                        <TableHead>Issue</TableHead>
                        <TableHead className="text-center">BL</TableHead>
                        <TableHead>PR</TableHead>
                        <TableHead className="text-center">Files</TableHead>
                        <TableHead className="text-center">Code</TableHead>
                        <TableHead className="text-center">Docs</TableHead>
                        <TableHead className="text-center">+/-</TableHead>
                        <TableHead className="text-center">Block</TableHead>
                        <TableHead>Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredIssues.map((issue) => (
                        <TableRow
                          key={issue.id}
                          className={`border-b border-border hover:bg-muted/50 ${issue.isBlacklisted ? 'bg-muted/25' : ''}`}
                        >
                          <TableCell className="text-foreground">#{issue.number}</TableCell>
                          <TableCell className="text-foreground font-medium max-w-xs truncate">
                            {issue.title}
                          </TableCell>
                          <TableCell>
                            <a
                              href={issue.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline text-sm"
                            >
                              Open Issue
                            </a>
                          </TableCell>
                          <TableCell className="text-center">
                            {issue.isBlacklisted ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex text-amber-500">
                                    <Ban className="h-4 w-4" aria-hidden />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                  On blacklist (repo or this issue)
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {issue.linkedPR ? (
                              <a
                                href={issue.linkedPR}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline text-sm"
                              >
                                View PR
                              </a>
                            ) : (
                              <span className="text-muted-foreground text-sm">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-foreground text-center">{issue.filesChanged.total}</TableCell>
                          <TableCell className="text-center">
                            <span className="badge-code">
                              {issue.filesChanged.code}
                            </span>
                          </TableCell>
                          <TableCell className="text-center">
                            <span className="badge-docs">
                              {issue.filesChanged.docs}
                            </span>
                          </TableCell>
                          <TableCell className="text-center text-sm">
                            <span className="text-emerald-400">+{issue.filesChanged.additions}</span>{' '}
                            <span className="text-rose-400">-{issue.filesChanged.deletions}</span>
                          </TableCell>
                          <TableCell>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  aria-label="Blacklist issue"
                                  className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8 w-8"
                                  disabled={
                                    blacklistBusyId === 'post' || Boolean(issue.isBlacklisted)
                                  }
                                  onClick={() => void handleBlacklistIssue(issue)}
                                >
                                  <Ban className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="top">Blacklist issue</TooltipContent>
                            </Tooltip>
                          </TableCell>
                          <TableCell>
                            <button
                              type="button"
                              onClick={() => setSelectedIssue(issue)}
                              className="text-primary hover:underline text-sm"
                            >
                              View Details
                            </button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  </div>
                </div>

                {selectedIssue && (
                  <div className="detail-panel mt-6">
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div>
                        <h3 className="text-xl font-semibold tracking-tight text-foreground">
                          #{selectedIssue.number} {selectedIssue.title}
                        </h3>
                        <p className="text-xs text-muted-foreground mt-1">
                          by {selectedIssue.author} • {selectedIssue.owner}/{selectedIssue.repo}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedIssue(null)}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        Close
                      </button>
                    </div>
                    {selectedIssue.isBlacklisted && (
                      <p
                        role="status"
                        className="status-info mb-4 flex items-center gap-2"
                      >
                        <Ban className="h-4 w-4 shrink-0" aria-hidden />
                        This issue or its repository is on your blacklist.
                      </p>
                    )}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                      <div className="lg:col-span-2 space-y-4">
                        <div>
                          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Description</p>
                          <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                            {selectedIssue.description || 'No description'}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Links</p>
                          <div className="flex flex-wrap gap-4 text-sm">
                            <a className="text-primary hover:underline" href={selectedIssue.url} target="_blank" rel="noreferrer">
                              Open Issue
                            </a>
                            {selectedIssue.linkedPR ? (
                              <a className="text-primary hover:underline" href={selectedIssue.linkedPR} target="_blank" rel="noreferrer">
                                Open PR
                              </a>
                            ) : (
                              <span className="text-muted-foreground">No PR linked</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2 text-sm">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Change Summary</p>
                        <p><span className="font-medium">Total files:</span> {selectedIssue.filesChanged.total}</p>
                        <p><span className="font-medium">Code:</span> {selectedIssue.filesChanged.code}</p>
                        <p><span className="font-medium">Docs:</span> {selectedIssue.filesChanged.docs}</p>
                        <p>
                          <span className="font-medium">Diff:</span>{' '}
                          <span className="text-emerald-500">+{selectedIssue.filesChanged.additions}</span>{' '}
                          <span className="text-rose-500">-{selectedIssue.filesChanged.deletions}</span>
                        </p>
                        <p><span className="font-medium">Merge commit:</span> {selectedIssue.commitHash || 'N/A'}</p>
                      </div>
                    </div>
                    <div className="pt-4">
                      <div className="pt-2">
                        <p className="font-medium">Snapshot Commit (closest commit at/before PR merge)</p>
                        <p className="text-muted-foreground break-all">
                          {snapshotLoading ? 'Resolving snapshot commit...' : snapshotCommitHash || 'N/A'}
                        </p>
                        {snapshotCommitHash && (
                          <div className="space-y-2 mt-2">
                            <div className="flex items-center gap-2">
                              <code className="text-xs bg-muted px-2 py-1 rounded">
                                {snapshotCommitHash}
                              </code>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => copyText(snapshotCommitHash, 'hash')}
                              >
                                {copiedField === 'hash' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                              </Button>
                            </div>
                            <div className="flex items-center gap-2">
                              <code className="text-xs bg-muted px-2 py-1 rounded break-all">
                                {`git checkout ${snapshotCommitHash}`}
                              </code>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                copyText(`git checkout ${snapshotCommitHash}`, 'checkout')
                              }
                            >
                              {copiedField === 'checkout' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                            </Button>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="pt-3">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              aria-label="Blacklist issue"
                              className="border-destructive/50 text-destructive hover:bg-destructive/10 h-8 w-8"
                              disabled={
                                blacklistBusyId === 'post' ||
                                Boolean(selectedIssue.isBlacklisted)
                              }
                              onClick={() => void handleBlacklistIssue(selectedIssue)}
                            >
                              <Ban className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="top">Blacklist issue</TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {hasFetchedFinder && !finderLoading && issues.length === 0 && (
              <div className="section-card p-6 animate-fade-in">
                <p className="text-sm text-muted-foreground">
                  No issues were returned for this repository. Try another repo, or verify the configured GitHub token has permission.
                </p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="repo-finder" className="mt-0">
            <div className="section-card mb-6 mt-4 animate-fade-in">
              <div className="p-6">
                <h2 className="text-base font-semibold text-foreground mb-4">Repository Finder</h2>
                <form onSubmit={handleRepoFinder} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-2">
                        Language
                      </label>
                      <Select
                        value={repoFinderLanguage}
                        onValueChange={setRepoFinderLanguage}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select a language" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Any">Any</SelectItem>
                          {REPO_FINDER_LANGUAGES.map((language) => (
                            <SelectItem key={language} value={language}>
                              {language}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-2">
                        Min Stars
                      </label>
                      <Input
                        type="number"
                        min={0}
                        value={repoFinderMinStars}
                        onChange={(e) => setRepoFinderMinStars(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-2">
                        Min Closed Issues
                      </label>
                      <Input
                        type="number"
                        min={0}
                        value={repoFinderMinIssues}
                        onChange={(e) => setRepoFinderMinIssues(e.target.value)}
                      />
                    </div>
                  </div>
                  {error && (
                    <div role="alert" aria-live="polite" className="status-error flex items-start gap-2">
                      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                      {error}
                    </div>
                  )}
                  <button type="submit" disabled={isRepoFinderDisabled} className="btn-primary-gradient">
                    {repoFinderLoading ? 'Finding Repositories...' : 'Find Repositories'}
                  </button>
                </form>
              </div>
            </div>

            {repoFinderResults.length > 0 && (
              <div className="pro-table-wrapper mb-6 animate-fade-in">
                <div className="max-h-[440px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Repository</TableHead>
                        <TableHead>Language</TableHead>
                        <TableHead className="text-center">Stars</TableHead>
                        <TableHead className="text-center">Closed Issues</TableHead>
                        <TableHead className="text-center">BL</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {repoFinderResults.map((repoResult) => (
                        <TableRow key={repoResult.id}>
                          <TableCell className="font-medium">{repoResult.fullName}</TableCell>
                          <TableCell>{repoResult.language || 'N/A'}</TableCell>
                          <TableCell className="text-center">{repoResult.stars}</TableCell>
                          <TableCell className="text-center">{repoResult.closedIssues}</TableCell>
                          <TableCell className="text-center">
                            {repoResult.isBlacklisted ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex text-amber-500">
                                    <Ban className="h-4 w-4" />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>Repository is blacklisted</TooltipContent>
                              </Tooltip>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    onClick={() => void handleCopyRepoUrl(repoResult)}
                                  >
                                    {copiedRepoId === repoResult.id ? (
                                      <Check className="h-4 w-4" />
                                    ) : (
                                      <Copy className="h-4 w-4" />
                                    )}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Copy repository link</TooltipContent>
                              </Tooltip>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setSelectedRepoResult(repoResult)}
                              >
                                View Detail
                              </Button>
                              <a
                                href={repoResult.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex"
                              >
                                <Button type="button" variant="ghost" size="icon">
                                  <ExternalLink className="h-4 w-4" />
                                </Button>
                              </a>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {selectedRepoResult && (
              <div className="detail-panel">
                <h3 className="text-xl font-semibold tracking-tight">{selectedRepoResult.fullName}</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {selectedRepoResult.description || 'No description'}
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-sm">
                  <p><span className="font-medium">Stars:</span> {selectedRepoResult.stars}</p>
                  <p><span className="font-medium">Forks:</span> {selectedRepoResult.forks}</p>
                  <p><span className="font-medium">Closed issues:</span> {selectedRepoResult.closedIssues}</p>
                  <p><span className="font-medium">Branch:</span> {selectedRepoResult.defaultBranch}</p>
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <a href={selectedRepoResult.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                    Open on GitHub
                  </a>
                  <span className="text-xs text-muted-foreground">
                    Updated {new Date(selectedRepoResult.updatedAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="lookup" className="mt-0">
            <div className="section-card mb-6 mt-4 animate-fade-in">
              <div className="p-6">
                <h2 className="text-base font-semibold text-foreground mb-4">Issue Lookup</h2>
                <form onSubmit={handleIssueLookup} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="issue-url" className="block text-sm font-medium text-foreground mb-2">
                        Issue URL
                      </label>
                      <Input
                        id="issue-url"
                        value={issueUrl}
                        onChange={(e) => setIssueUrl(e.target.value)}
                        placeholder="https://github.com/owner/repo/issues/123"
                        required
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Uses the API key configured by admin.
                  </p>
                  {error && (
                    <div role="alert" aria-live="polite" className="status-error flex items-start gap-2">
                      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                      {error}
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={isLookupDisabled}
                    className="btn-primary-gradient"
                  >
                    {lookupLoading ? 'Looking up...' : 'Lookup Issue'}
                  </button>
                </form>
              </div>
            </div>

            {lookupIssue && (
              <div className="detail-panel">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <h3 className="text-xl font-semibold tracking-tight text-foreground">
                      #{lookupIssue.number} {lookupIssue.title}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      by {lookupIssue.author} • {lookupIssue.owner}/{lookupIssue.repo}
                    </p>
                  </div>
                </div>
                {lookupIssue.isBlacklisted && (
                  <p
                    role="status"
                    className="status-info mb-4 flex items-center gap-2"
                  >
                    <Ban className="h-4 w-4 shrink-0" aria-hidden />
                    This issue or its repository is on your blacklist.
                  </p>
                )}
                {lookupRepoBlacklisted && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <p className="text-xs text-muted-foreground mb-4 inline-flex cursor-help">
                        Repository-level blacklist is active for this issue&apos;s repo.
                      </p>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      Repo blacklist means all issues in this repository are treated as blocked.
                    </TooltipContent>
                  </Tooltip>
                )}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <div className="lg:col-span-2 space-y-4">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Description</p>
                      <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                        {lookupIssue.description || 'No description'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Timeline</p>
                      <p className="text-sm"><span className="font-medium">Created:</span> {new Date(lookupIssue.createdAt).toLocaleString()}</p>
                      <p className="text-sm"><span className="font-medium">Updated:</span> {new Date(lookupIssue.updatedAt).toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Links</p>
                      <div className="flex flex-wrap gap-4 text-sm">
                        <a className="text-primary hover:underline" href={lookupIssue.url} target="_blank" rel="noreferrer">Open Issue</a>
                        {lookupIssue.linkedPR ? (
                          <a className="text-primary hover:underline" href={lookupIssue.linkedPR} target="_blank" rel="noreferrer">Open PR</a>
                        ) : (
                          <span className="text-muted-foreground">No PR linked</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2 text-sm">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Change Summary</p>
                    <p><span className="font-medium">Total files:</span> {lookupIssue.filesChanged.total}</p>
                    <p><span className="font-medium">Code:</span> {lookupIssue.filesChanged.code}</p>
                    <p><span className="font-medium">Docs:</span> {lookupIssue.filesChanged.docs}</p>
                    <p>
                      <span className="font-medium">Diff:</span>{' '}
                      <span className="text-emerald-500">+{lookupIssue.filesChanged.additions}</span>{' '}
                      <span className="text-rose-500">-{lookupIssue.filesChanged.deletions}</span>
                    </p>
                    <p><span className="font-medium">Merge commit:</span> {lookupIssue.commitHash || 'N/A'}</p>
                  </div>
                </div>
                <div className="pt-4">
                  <div className="pt-2">
                    <p className="font-medium">Snapshot Commit (closest commit at/before PR merge)</p>
                    <p className="text-muted-foreground break-all">
                      {lookupSnapshotLoading
                        ? 'Resolving snapshot commit...'
                        : lookupSnapshotCommitHash || 'N/A'}
                    </p>
                    {lookupSnapshotCommitHash && (
                      <div className="space-y-2 mt-2">
                        <div className="flex items-center gap-2">
                          <code className="text-xs bg-muted px-2 py-1 rounded">
                            {lookupSnapshotCommitHash}
                          </code>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => copyText(lookupSnapshotCommitHash, 'hash')}
                          >
                            {copiedField === 'hash' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                          </Button>
                        </div>
                        <div className="flex items-center gap-2">
                          <code className="text-xs bg-muted px-2 py-1 rounded break-all">
                            {`git checkout ${lookupSnapshotCommitHash}`}
                          </code>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              copyText(`git checkout ${lookupSnapshotCommitHash}`, 'checkout')
                            }
                          >
                            {copiedField === 'checkout' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="pt-4 flex flex-wrap gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void handleLookupShowRepoInfo()}
                        disabled={lookupRepoInfoLoading}
                      >
                        {lookupRepoInfoLoading ? 'Loading Repo Info...' : 'Show Repo Info'}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      Loads this issue&apos;s repository details in the repository info panel.
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label="Blacklist issue"
                        className="border-destructive/50 text-destructive hover:bg-destructive/10 h-8 w-8"
                        disabled={
                          blacklistBusyId === 'post' || Boolean(lookupIssue.isBlacklisted)
                        }
                        onClick={() => void handleBlacklistIssue(lookupIssue)}
                      >
                        <Ban className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Blacklist issue</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="blacklist" className="mt-0">
            <div className="section-card mb-6 mt-4 animate-fade-in">
              <div className="p-6 space-y-6">
                <div>
                  <h2 className="text-base font-semibold text-foreground mb-1">Blacklist</h2>
                  <p className="text-sm text-muted-foreground">
                    Block repositories or specific issues from Issue Finder, lookup, and repo info.
                    Entries are saved with your app data.
                  </p>
                </div>

                {blacklistError && (
                  <div role="alert" className="status-error flex items-start gap-2">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    {blacklistError}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <form onSubmit={handleManualRepoBlacklist} className="space-y-2">
                    <label htmlFor="manual-repo-bl" className="text-sm font-medium text-foreground">
                      Add repository
                    </label>
                    <Input
                      id="manual-repo-bl"
                      placeholder="https://github.com/owner/repo or owner/repo"
                      value={manualRepoBlacklist}
                      onChange={(e) => setManualRepoBlacklist(e.target.value)}
                    />
                    <Button type="submit" disabled={!manualRepoBlacklist.trim() || blacklistBusyId === 'post'} variant="outline">
                      Blacklist repository
                    </Button>
                  </form>
                  <form onSubmit={handleManualIssueBlacklist} className="space-y-2">
                    <label htmlFor="manual-issue-bl" className="text-sm font-medium text-foreground">
                      Add issue
                    </label>
                    <Input
                      id="manual-issue-bl"
                      placeholder="https://github.com/owner/repo/issues/123"
                      value={manualIssueBlacklist}
                      onChange={(e) => setManualIssueBlacklist(e.target.value)}
                    />
                    <Button type="submit" disabled={!manualIssueBlacklist.trim() || blacklistBusyId === 'post'} variant="outline">
                      Blacklist issue
                    </Button>
                  </form>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-3">Blacklisted items</h3>
                  {blacklistEntries.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No entries yet.</p>
                  ) : (
                    <div className="pro-table-wrapper">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Type</TableHead>
                            <TableHead>Target</TableHead>
                            <TableHead className="w-[120px]">Remove</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {blacklistEntries.map((row) => (
                            <TableRow key={row.id}>
                              <TableCell className="capitalize">{row.kind}</TableCell>
                              <TableCell>
                                <code className="text-xs bg-muted px-2 py-0.5 rounded">{row.label}</code>
                              </TableCell>
                              <TableCell>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={blacklistBusyId === row.id}
                                  className="text-destructive"
                                  onClick={() => void handleRemoveBlacklist(row.id)}
                                >
                                  Remove
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}
