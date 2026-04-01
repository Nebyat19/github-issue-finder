'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArrowLeft, FileCode2, FileText, GitCommitHorizontal, Link2 } from 'lucide-react';
import Link from 'next/link';

interface IssueDetail {
  number: number;
  title: string;
  description: string;
  url: string;
  linkedPR?: string;
  commitHash?: string;
  filesChanged: {
    total: number;
    code: number;
    docs: number;
  };
  author: string;
}

export default function IssueDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [isMounted, setIsMounted] = useState(false);
  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const issueNumber = params.number as string;

  useEffect(() => {
    setIsMounted(true);
    const token = localStorage.getItem('token');
    if (!token) {
      router.replace('/login');
      return;
    }

    const payload = searchParams.get('data');
    if (payload) {
      try {
        const parsed = JSON.parse(decodeURIComponent(payload)) as IssueDetail;
        setIssue(parsed);
      } catch {
        setIssue(null);
      }
    }

    setLoading(false);
  }, [router, searchParams]);

  if (!isMounted) {
    return <div className="app-shell" />;
  }

  if (loading) {
    return (
      <div className="app-shell flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading issue details...</p>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card className="section-card p-6 md:p-8">
          <div className="mb-6">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground mb-2">
              Issue #{issueNumber} Overview
            </h1>
            <p className="text-muted-foreground">Detailed issue data in a compact, readable layout.</p>
          </div>

          {!issue ? (
            <p className="status-info">
              Issue details are not available. Please open this page from Dashboard.
            </p>
          ) : (
            <div className="space-y-6">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Title</p>
                <h2 className="text-xl font-semibold text-foreground">{issue.title}</h2>
                <p className="text-xs text-muted-foreground mt-1">Author: {issue.author}</p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Description</p>
                  <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap rounded-lg border border-border bg-muted/20 p-4 min-h-[140px]">
                    {issue.description || 'No description'}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2 text-sm">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Change Summary</p>
                  <p className="inline-flex items-center gap-2"><FileCode2 className="h-4 w-4 text-primary" /> Code files: {issue.filesChanged.code}</p>
                  <p className="inline-flex items-center gap-2"><FileText className="h-4 w-4 text-primary" /> Doc files: {issue.filesChanged.docs}</p>
                  <p>Total files: {issue.filesChanged.total}</p>
                  <p className="inline-flex items-center gap-2"><GitCommitHorizontal className="h-4 w-4 text-primary" /> Commit: {issue.commitHash || 'N/A'}</p>
                </div>
              </div>

              <div className="rounded-lg border border-border p-4 text-sm">
                <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">References</p>
                <div className="flex flex-wrap gap-4">
                  <a href={issue.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-primary hover:underline">
                    <Link2 className="h-4 w-4" />
                    Open Issue
                  </a>
                  {issue.linkedPR ? (
                    <a href={issue.linkedPR} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-primary hover:underline">
                      <Link2 className="h-4 w-4" />
                      Open PR
                    </a>
                  ) : (
                    <span className="text-muted-foreground">No PR linked</span>
                  )}
                </div>
              </div>

              <div className="pt-2">
                <Button
                  onClick={() => router.replace('/dashboard')}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  Return to Dashboard
                </Button>
              </div>
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}
