// /auth/redeem?token=<custom-token>
//
// Landing page for the admin-issued sign-in link. Reads the token from
// the query string, hands it to Firebase via signInWithCustomToken, and
// redirects to home on success. The user's Firebase Auth password is
// never touched — the token authenticates the session in its own right.
//
// Failure modes the page actually surfaces:
//   - missing token → show an "open the link from your admin" hint
//   - expired token (>1h) → Firebase throws; we show the error message
//   - already-signed-in user redeeming someone else's link → Firebase
//     replaces the session; that's intentional, the new auth state
//     drives App.tsx to reload the right profile
//
// Layout note: this route renders inside the normal App shell (Sidebar
// + Navbar). When the visitor isn't signed in yet, the shell shows
// empty/inert state, which is fine — they're only on this page for a
// second before sign-in completes.

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { auth, signInWithCustomToken } from '../../lib/firebase';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';

type Status = 'pending' | 'signing-in' | 'success' | 'error';

export default function RedeemTokenPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>('pending');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const token = searchParams.get('token') || '';

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setErrorMessage('No sign-in token in the URL. Open the link your admin shared with you.');
      return;
    }

    let cancelled = false;
    setStatus('signing-in');

    (async () => {
      try {
        await signInWithCustomToken(auth, token);
        if (cancelled) return;
        setStatus('success');
        // Give onAuthStateChanged in App.tsx a tick to fire and load the
        // profile, then send the user home. We don't await a profile
        // load here — App.tsx renders its loading shell while the
        // profile fetch is in flight.
        setTimeout(() => {
          if (!cancelled) navigate('/', { replace: true });
        }, 250);
      } catch (err: any) {
        if (cancelled) return;
        const raw = err?.message || String(err);
        // Firebase tags expired/invalid tokens as auth/invalid-custom-token
        // or auth/custom-token-mismatch. Surface a friendlier hint when we
        // recognise the code; otherwise show the raw message so the admin
        // can debug.
        const friendly = raw.includes('expired') || raw.includes('invalid-custom-token')
          ? 'This sign-in link has expired or is invalid. Ask your admin for a fresh link.'
          : raw;
        setStatus('error');
        setErrorMessage(friendly);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, navigate]);

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="font-serif text-2xl">
            {status === 'success' ? 'Signed in' : 'Redeeming sign-in link'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === 'pending' && (
            <p className="text-sm text-ink/70">Preparing…</p>
          )}
          {status === 'signing-in' && (
            <p className="text-sm text-ink/70 animate-pulse">Signing you in…</p>
          )}
          {status === 'success' && (
            <p className="text-sm text-ink/70">
              You're in. Redirecting…
            </p>
          )}
          {status === 'error' && (
            <>
              <p className="text-sm text-destructive">{errorMessage}</p>
              <Button
                onClick={() => navigate('/', { replace: true })}
                className="bg-gold text-white"
              >
                Go to home
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
