'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { CheckCircle2, Eye, EyeOff, Info } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignup, setIsSignup] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const router = useRouter();
  const isPasswordMismatch =
    isSignup && confirmPassword.length > 0 && password !== confirmPassword;
  const isSubmitDisabled =
    loading ||
    !email.trim() ||
    password.length < 8 ||
    (isSignup && (!confirmPassword || isPasswordMismatch));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');

    if (isSignup && password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      const endpoint = isSignup ? '/api/auth/signup' : '/api/auth/login';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = (await response.json()) as {
        error?: string;
        message?: string;
        token?: string;
      };

      if (!response.ok) {
        setError(data.error || 'Authentication failed');
        return;
      }

      if (data.token) {
        localStorage.setItem('token', data.token);
        router.replace('/dashboard');
      } else {
        setInfo(data.message || 'Account created. Awaiting admin approval.');
      }
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-shell flex items-center justify-center p-4">
      <Card className="section-card w-full max-w-md">
        <div className="p-8">
          <div className="mb-8">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground text-center">
              GitHub Issues Analyzer
            </h1>
            <p className="text-sm text-muted-foreground text-center mt-2 leading-relaxed">
              {isSignup ? 'Create an account' : 'Sign in to your account'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-foreground mb-2">
                Email
              </label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
                className="w-full"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-foreground mb-2">
                Password
              </label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  minLength={8}
                  required
                  autoComplete={isSignup ? 'new-password' : 'current-password'}
                  className="w-full pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Use at least 8 characters.
              </p>
            </div>

            {isSignup && (
              <div>
                <label htmlFor="confirm-password" className="block text-sm font-medium text-foreground mb-2">
                  Confirm Password
                </label>
                <div className="relative">
                  <Input
                    id="confirm-password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    minLength={8}
                    required
                    autoComplete="new-password"
                    className="w-full pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                  >
                    {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {isPasswordMismatch && (
                  <p className="text-xs text-destructive mt-2">Passwords do not match.</p>
                )}
              </div>
            )}

            {error && (
              <div role="alert" aria-live="polite" className="status-error flex items-start gap-2">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            {info && (
              <div role="status" aria-live="polite" className="status-success flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                {info}
              </div>
            )}

            <Button
              type="submit"
              disabled={isSubmitDisabled}
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {loading ? 'Loading...' : isSignup ? 'Sign up' : 'Sign in'}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={() => {
                setIsSignup(!isSignup);
                setError('');
                setPassword('');
                setConfirmPassword('');
                setShowPassword(false);
                setShowConfirmPassword(false);
              }}
              className="text-sm text-muted-foreground hover:text-foreground underline"
            >
              {isSignup
                ? 'Already have an account? Sign in'
                : 'Create an account'}
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}
