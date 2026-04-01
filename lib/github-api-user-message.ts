/**
 * Turn verbose GitHub API errors into short strings for the UI.
 */
export function shortGithubUserFacingMessage(message: string | null | undefined): string {
  if (message == null) return '';
  const m = String(message).trim();
  if (!m) return '';

  const lower = m.toLowerCase();
  if (
    lower.includes('api rate limit exceeded') ||
    lower.includes('rate limit exceeded') ||
    lower.includes('secondary rate limit')
  ) {
    return 'API rate limit exceeded — wait a sec and try again.';
  }

  return m;
}
