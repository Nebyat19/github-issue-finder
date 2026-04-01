'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <Link href="/dashboard" className="text-primary hover:underline text-sm">
            ← Back to Dashboard
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card className="section-card p-6">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-foreground mb-2">
              Issue #{issueNumber}
            </h1>
            <p className="text-muted-foreground">Detailed issue information.</p>
          </div>

          {!issue ? (
            <p className="text-muted-foreground">
              Issue details are not available. Please open this page from Dashboard.
            </p>
          ) : (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-foreground mb-2">
                Title
              </h2>
              <p className="text-foreground">{issue.title}</p>
            </div>

            <div>
              <h2 className="text-lg font-semibold text-foreground mb-2">
                Description
              </h2>
              <p className="text-foreground whitespace-pre-wrap">
                {issue.description || 'No description'}
              </p>
            </div>

            <div>
              <h2 className="text-lg font-semibold text-foreground mb-2">Metadata</h2>
              <div className="space-y-1 text-sm">
                <p><span className="font-medium text-foreground">Author:</span> {issue.author}</p>
                <p><span className="font-medium text-foreground">Total Files Changed:</span> {issue.filesChanged.total}</p>
                <p><span className="font-medium text-foreground">Code Changes:</span> {issue.filesChanged.code}</p>
                <p><span className="font-medium text-foreground">Docs Changes:</span> {issue.filesChanged.docs}</p>
                <p><span className="font-medium text-foreground">Commit Hash:</span> {issue.commitHash || 'N/A'}</p>
                <p>
                  <span className="font-medium text-foreground">Issue Link:</span>{' '}
                  <a href={issue.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">Open</a>
                </p>
                <p>
                  <span className="font-medium text-foreground">PR Link:</span>{' '}
                  {issue.linkedPR ? (
                    <a href={issue.linkedPR} target="_blank" rel="noreferrer" className="text-primary hover:underline">Open</a>
                  ) : (
                    'N/A'
                  )}
                </p>
              </div>
            </div>

            <div className="pt-4">
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
