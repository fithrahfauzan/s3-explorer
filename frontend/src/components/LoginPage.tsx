import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { authApi } from '@/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Lock, Loader2 } from 'lucide-react';
import { AUTH_STATUS_QUERY_KEY } from '@/lib/auth';

export function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const queryClient = useQueryClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || isSubmitting) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await authApi.login(password);
      await queryClient.invalidateQueries({ queryKey: AUTH_STATUS_QUERY_KEY });
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 429) {
        setError('Too many attempts. Try again in a minute.');
      } else if (axios.isAxiosError(err) && err.response?.status === 401) {
        setError('Incorrect password.');
      } else {
        setError('Login failed. Try again.');
      }
    } finally {
      setIsSubmitting(false);
      setPassword('');
    }
  };

  return (
    <div className="flex min-h-[70vh] items-center justify-center p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm border border-border rounded-lg bg-card p-6 flex flex-col gap-4"
      >
        <div className="flex items-center gap-2">
          <Lock className="w-4 h-4 text-primary" />
          <h2 className="font-mono text-sm font-medium">Sign in</h2>
        </div>
        <Input
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="font-mono text-xs"
          aria-invalid={!!error}
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button type="submit" disabled={!password || isSubmitting}>
          {isSubmitting && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
          Sign in
        </Button>
      </form>
    </div>
  );
}
