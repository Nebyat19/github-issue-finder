'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  CheckCircle2,
  Clock3,
  KeyRound,
  Shield,
  Users,
} from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Link from 'next/link';

interface User {
  id: string;
  email: string;
  role: 'admin' | 'user';
  isApproved: boolean;
  isBanned: boolean;
  isAdmin?: boolean;
  createdAt: string;
}

interface ApiKey {
  id: string;
  token: string;
  isActive: boolean;
  createdAt: string;
  userId: string;
  userEmail?: string;
}

export default function AdminPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newKeyToken, setNewKeyToken] = useState('');
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null);
  const [editingTokenValue, setEditingTokenValue] = useState('');
  const [adminSection, setAdminSection] = useState<
    'keys' | 'approved' | 'pending' | 'banned'
  >('keys');
  const [isMounted, setIsMounted] = useState(false);
  const router = useRouter();
  const isAddKeyDisabled = !newKeyToken.trim();
  const pendingUsers = users.filter((u) => !u.isApproved && !u.isBanned);
  const approvedUsers = users.filter((u) => u.isApproved && !u.isBanned);
  const bannedUsers = users.filter((u) => u.isBanned);

  useEffect(() => {
    setIsMounted(true);
    const fetchUsers = async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          router.replace('/login');
          return;
        }

        const response = await fetch('/api/admin/users', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = (await response.json()) as {
          error?: string;
          users?: User[];
        };

        if (!response.ok) {
          if (response.status === 403) {
            router.replace('/dashboard');
            return;
          }
          setError(data.error || 'Failed to load users');
          return;
        }

        setUsers(data.users || []);

        const keysResponse = await fetch('/api/admin/api-keys', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const keysData = (await keysResponse.json()) as {
          error?: string;
          apiKeys?: ApiKey[];
        };
        if (keysResponse.ok) {
          setApiKeys(keysData.apiKeys || []);
        }
      } catch {
        setError('Failed to load users');
      } finally {
        setLoading(false);
      }
    };

    fetchUsers();
  }, [router]);

  const handleApproveUser = async (userId: string) => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        router.replace('/login');
        return;
      }

      const response = await fetch(`/api/admin/users/${userId}/approve`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error || 'Failed to approve user');
        return;
      }

      setUsers((prev) =>
        prev.map((user) =>
          user.id === userId
            ? { ...user, isApproved: true, isBanned: false }
            : user
        )
      );
    } catch {
      setError('Failed to approve user');
    }
  };

  const handleBanUser = async (userId: string) => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        router.replace('/login');
        return;
      }

      const response = await fetch(`/api/admin/users/${userId}/ban`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error || 'Failed to ban user');
        return;
      }

      setUsers((prev) =>
        prev.map((user) =>
          user.id === userId
            ? { ...user, isApproved: false, isBanned: true }
            : user
        )
      );
    } catch {
      setError('Failed to ban user');
    }
  };

  const handleUnbanUser = async (userId: string) => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        router.replace('/login');
        return;
      }

      const response = await fetch(`/api/admin/users/${userId}/unban`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error || 'Failed to unban user');
        return;
      }

      setUsers((prev) =>
        prev.map((user) =>
          user.id === userId
            ? { ...user, isApproved: false, isBanned: false }
            : user
        )
      );
    } catch {
      setError('Failed to unban user');
    }
  };

  const handleAddApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        router.replace('/login');
        return;
      }

      const response = await fetch('/api/admin/api-keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          token: newKeyToken.trim(),
        }),
      });

      const data = (await response.json()) as { error?: string; apiKey?: ApiKey };
      if (!response.ok) {
        setError(data.error || 'Failed to add API key');
        return;
      }

      if (data.apiKey) {
        setApiKeys((prev) => [data.apiKey!, ...prev]);
      }
      setNewKeyToken('');
    } catch {
      setError('Failed to add API key');
    }
  };

  const handleDeleteApiKey = async (keyId: string) => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        router.replace('/login');
        return;
      }

      const response = await fetch(`/api/admin/api-keys/${keyId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error || 'Failed to delete API key');
        return;
      }

      setApiKeys((prev) => prev.filter((key) => key.id !== keyId));
    } catch {
      setError('Failed to delete API key');
    }
  };

  const handleToggleApiKey = async (keyId: string, isActive: boolean) => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        router.replace('/login');
        return;
      }

      const response = await fetch(`/api/admin/api-keys/${keyId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ isActive }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error || 'Failed to update API key status');
        return;
      }

      setApiKeys((prev) =>
        prev.map((key) => (key.id === keyId ? { ...key, isActive } : key))
      );
    } catch {
      setError('Failed to update API key status');
    }
  };

  const startEditApiKey = (key: ApiKey) => {
    setEditingKeyId(key.id);
    setEditingTokenValue(key.token);
  };

  const handleUpdateApiKey = async (keyId: string) => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        router.replace('/login');
        return;
      }

      const response = await fetch(`/api/admin/api-keys/${keyId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ token: editingTokenValue.trim() }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error || 'Failed to update API key');
        return;
      }

      setApiKeys((prev) =>
        prev.map((key) =>
          key.id === keyId ? { ...key, token: editingTokenValue.trim() } : key
        )
      );
      setEditingKeyId(null);
      setEditingTokenValue('');
    } catch {
      setError('Failed to update API key');
    }
  };

  if (!isMounted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading admin panel...</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="app-shell flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading users...</p>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {/* Header */}
      <header className="app-header">
        <div className="mx-auto w-full px-4 py-6 sm:px-6 lg:px-8 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              Admin Panel
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage users and API keys
            </p>
          </div>
          <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          <Card className="section-card p-4">
            <p className="text-xs text-muted-foreground">Pending approvals</p>
            <p className="mt-1 text-2xl font-semibold inline-flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-primary" />
              {pendingUsers.length}
            </p>
          </Card>
          <Card className="section-card p-4">
            <p className="text-xs text-muted-foreground">Approved users</p>
            <p className="mt-1 text-2xl font-semibold inline-flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              {approvedUsers.length}
            </p>
          </Card>
          <Card className="section-card p-4">
            <p className="text-xs text-muted-foreground">Banned users</p>
            <p className="mt-1 text-2xl font-semibold inline-flex items-center gap-2">
              <Ban className="h-4 w-4 text-amber-500" />
              {bannedUsers.length}
            </p>
          </Card>
          <Card className="section-card p-4">
            <p className="text-xs text-muted-foreground">API keys</p>
            <p className="mt-1 text-2xl font-semibold inline-flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" />
              {apiKeys.length}
            </p>
          </Card>
        </div>

        {error && (
          <div role="alert" aria-live="polite" className="status-error mb-6 flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-6 items-start">
          <aside className="section-card bg-sidebar/85 p-3 lg:sticky lg:top-4">
            <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Admin Sections
            </p>
            <div className="space-y-1">
              <Button
                type="button"
                variant={adminSection === 'keys' ? 'default' : 'ghost'}
                className="w-full justify-start rounded-xl"
                onClick={() => setAdminSection('keys')}
              >
                API Keys
              </Button>
              <Button
                type="button"
                variant={adminSection === 'approved' ? 'default' : 'ghost'}
                className="w-full justify-start rounded-xl"
                onClick={() => setAdminSection('approved')}
              >
                Approved Users
              </Button>
              <Button
                type="button"
                variant={adminSection === 'pending' ? 'default' : 'ghost'}
                className="w-full justify-start rounded-xl"
                onClick={() => setAdminSection('pending')}
              >
                Pending User Approvals
              </Button>
              <Button
                type="button"
                variant={adminSection === 'banned' ? 'default' : 'ghost'}
                className="w-full justify-start rounded-xl"
                onClick={() => setAdminSection('banned')}
              >
                Banned Users
              </Button>
            </div>
          </aside>
          <div>
        {/* Pending Users Section */}
        {adminSection === 'pending' && (
        <Card className="section-card mb-8">
          <div className="p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4 inline-flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              Pending User Approvals
            </h2>
            {pendingUsers.length === 0 ? (
              <p className="text-muted-foreground">No pending approvals</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-border">
                    <TableHead className="text-foreground">Email</TableHead>
                    <TableHead className="text-foreground">Created</TableHead>
                    <TableHead className="text-foreground">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingUsers.map((user) => (
                      <TableRow key={user.id} className="border-b border-border">
                        <TableCell className="text-foreground">
                          {user.email}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(user.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button
                              onClick={() => handleApproveUser(user.id)}
                              size="sm"
                              className="bg-primary hover:bg-primary/90 text-primary-foreground"
                            >
                              Approve
                            </Button>
                            <Button
                              onClick={() => handleBanUser(user.id)}
                              size="sm"
                              variant="outline"
                              disabled={user.role === 'admin'}
                            >
                              Ban
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </Card>
        )}

        {/* Approved Users Section */}
        {adminSection === 'approved' && (
        <Card className="section-card mb-8">
          <div className="p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">
              Approved Users ({approvedUsers.length})
            </h2>
            {approvedUsers.length === 0 ? (
              <p className="text-muted-foreground">No approved users</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-border">
                    <TableHead className="text-foreground">Email</TableHead>
                    <TableHead className="text-foreground">Created</TableHead>
                    <TableHead className="text-foreground">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {approvedUsers.map((user) => (
                      <TableRow key={user.id} className="border-b border-border">
                        <TableCell className="text-foreground">
                          {user.email}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(user.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <Button
                            onClick={() => handleBanUser(user.id)}
                            size="sm"
                            variant="outline"
                            disabled={user.role === 'admin'}
                          >
                            Ban
                          </Button>
                        </TableCell>
                      </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </Card>
        )}

        {adminSection === 'banned' && (
        <Card className="section-card mb-8">
          <div className="p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">
              Banned Users ({bannedUsers.length})
            </h2>
            {bannedUsers.length === 0 ? (
              <p className="text-muted-foreground">No banned users</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-border">
                    <TableHead className="text-foreground">Email</TableHead>
                    <TableHead className="text-foreground">Created</TableHead>
                    <TableHead className="text-foreground">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bannedUsers.map((user) => (
                    <TableRow key={user.id} className="border-b border-border">
                      <TableCell className="text-foreground">{user.email}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(user.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <Button
                          onClick={() => handleUnbanUser(user.id)}
                          size="sm"
                          variant="outline"
                        >
                          Unban
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </Card>
        )}

        {/* API Keys Section */}
        {adminSection === 'keys' && (
        <Card className="section-card">
          <div className="p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4 inline-flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" />
              API Keys
            </h2>
            <form onSubmit={handleAddApiKey} className="space-y-4 mb-6">
              <div className="grid grid-cols-1 gap-4">
                <Input
                  placeholder="GitHub Token"
                  type="password"
                  value={newKeyToken}
                  onChange={(e) => setNewKeyToken(e.target.value)}
                  autoComplete="off"
                  required
                />
              </div>
              <p className="text-xs text-muted-foreground">
                This token is shared across all users. Tokens are masked in the table.
              </p>
              <Button
                type="submit"
                disabled={isAddKeyDisabled}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                Add API Key
              </Button>
            </form>

            {apiKeys.length === 0 ? (
              <p className="text-muted-foreground">No API keys configured</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-border">
                    <TableHead className="text-foreground">User Email</TableHead>
                    <TableHead className="text-foreground">Token</TableHead>
                    <TableHead className="text-foreground">Status</TableHead>
                    <TableHead className="text-foreground">Created</TableHead>
                    <TableHead className="text-foreground">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {apiKeys.map((key) => (
                    <TableRow key={key.id} className="border-b border-border">
                      <TableCell className="text-foreground">
                        {key.userEmail || `User ID: ${key.userId}`}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs font-mono">
                        {editingKeyId === key.id ? (
                          <Input
                            value={editingTokenValue}
                            onChange={(e) => setEditingTokenValue(e.target.value)}
                            className="h-8"
                          />
                        ) : (
                          `${key.token.substring(0, 20)}...`
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {key.isActive ? 'Active' : 'Inactive'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(key.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          {editingKeyId === key.id ? (
                            <>
                              <Button
                                size="sm"
                                onClick={() => handleUpdateApiKey(key.id)}
                              >
                                Save
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setEditingKeyId(null);
                                  setEditingTokenValue('');
                                }}
                              >
                                Cancel
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => startEditApiKey(key)}
                              >
                                Update
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  handleToggleApiKey(key.id, !key.isActive)
                                }
                              >
                                {key.isActive ? 'Deactivate' : 'Activate'}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleDeleteApiKey(key.id)}
                              >
                                Delete
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </Card>
        )}
          </div>
        </div>
      </main>
    </div>
  );
}
