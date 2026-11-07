import { MIN_PASSWORD, rankFor } from '@mathbattles/sim';
import { useEffect, useState } from 'preact/hooks';
import {
  addEmail,
  addUsernameAndPassword,
  changePassword,
  deleteAccount,
  linkGoogle,
  register,
  resetPassword,
  signIn,
  signInWithUsername,
  signOutUser,
  useAuth,
  type AuthResult,
} from '../auth';
import { go } from '../util';
import { TopBar } from './Shared';

function Notice({ result }: { result: AuthResult | null }) {
  if (!result) return null;
  if (result.error) return <p class="error" role="alert">{result.error}</p>;
  if (result.message) return <p class="ok" role="status">{result.message}</p>;
  return null;
}

function Credentials(props: {
  submitLabel: string;
  newPassword: boolean;
  onSubmit: (username: string, password: string) => Promise<AuthResult>;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AuthResult | null>(null);
  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setResult(null);
    const r = await props.onSubmit(username.trim(), password);
    setResult(r);
    setBusy(false);
    if (!r.error) setPassword('');
  };
  return (
    <form class="stack" onSubmit={(e) => void submit(e)}>
      <label>{props.newPassword ? 'Username' : 'Username or email'}
        <input
          name="username"
          value={username}
          maxLength={props.newPassword ? 16 : 254}
          autocomplete="username"
          autocapitalize="off"
          spellcheck={false}
          onInput={(e) => setUsername((e.target as HTMLInputElement).value)}
        />
      </label>
      <label>Password
        <input
          name="password"
          type="password"
          value={password}
          autocomplete={props.newPassword ? 'new-password' : 'current-password'}
          onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
        />
      </label>
      {props.newPassword && <p class="muted small-note">3 to 16 letters, numbers, or underscores. Passwords need at least {MIN_PASSWORD} characters.</p>}
      <button class="primary" disabled={busy}>{busy ? 'One moment' : props.submitLabel}</button>
      <Notice result={result} />
    </form>
  );
}

export function SignIn() {
  const auth = useAuth();
  const [mode, setMode] = useState<'in' | 'new' | 'forgot'>('in');
  const [email, setEmail] = useState('');
  const [forgot, setForgot] = useState<AuthResult | null>(null);

  useEffect(() => {
    if (auth.user) go('/profile');
  }, [auth.user]);

  return (
    <div class="page narrow">
      <TopBar title="Sign in" />
      <div class="sheet">
        <div class="row tabs" role="group" aria-label="Sign in or create an account">
          <button class={mode === 'in' ? 'on' : ''} aria-pressed={mode === 'in'} onClick={() => setMode('in')}>Sign in</button>
          <button class={mode === 'new' ? 'on' : ''} aria-pressed={mode === 'new'} onClick={() => setMode('new')}>Create account</button>
        </div>
        {mode === 'in' && <Credentials key="in" submitLabel="Sign in" newPassword={false} onSubmit={signInWithUsername} />}
        {mode === 'new' && <Credentials key="new" submitLabel="Create account" newPassword onSubmit={register} />}
        {mode === 'forgot' && (
          <form class="stack" onSubmit={(e) => { e.preventDefault(); void resetPassword(email).then(setForgot); }}>
            <p>Enter the email you added to your account, and we'll send a reset link.</p>
            <label>Email
              <input name="email" type="email" autocomplete="email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
            </label>
            <button class="primary">Send reset link</button>
            <Notice result={forgot} />
            <p class="muted small-note">No email on your account? If you linked Google, sign in with it, then choose a new password on your profile. Accounts with neither can't be recovered.</p>
          </form>
        )}
        <div class="row" style={{ marginTop: 14 }}>
          {mode !== 'forgot' && <button class="plain" onClick={() => setMode('forgot')}>Forgot your password?</button>}
          {mode === 'forgot' && <button class="plain" onClick={() => setMode('in')}>Back to sign in</button>}
        </div>
      </div>
      <div class="sheet">
        <h3>Or use Google</h3>
        <button onClick={() => void signIn()}>Sign in with Google</button>
        {auth.error && <p class="error" role="alert">{auth.error}</p>}
        <p class="muted small-note" style={{ marginTop: 10 }}>You can also keep playing as a guest. Your progress stays on this device.</p>
      </div>
    </div>
  );
}

export function AccountPanel() {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [result, setResult] = useState<AuthResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [newPassword, setNewPassword] = useState('');

  if (!auth.ready) return <p>Checking your account.</p>;
  if (!auth.user) {
    return (
      <>
        <p>You're playing as a guest, so progress stays on this device. Make a free account to keep it everywhere and play ranked.</p>
        <a class="btn primary" href="#/signin">Sign in or create an account</a>
      </>
    );
  }
  return (
    <div class="stack">
      <p>Signed in as <strong>{auth.username ?? auth.user.displayName ?? 'your account'}</strong>. Your progress syncs across devices.</p>
      {auth.rating !== null && <p>Rank: {rankFor(auth.rating)}</p>}

      {auth.hasGoogle ? <p class="ok">Google is linked.</p> : (
        <div>
          <button onClick={() => void linkGoogle().then(setResult)}>Add a Google account</button>
          <p class="muted small-note">Then you can sign in with Google too, which also helps if you forget your password.</p>
        </div>
      )}

      {auth.email ? <p class="ok">Email on this account: {auth.email}</p> : !auth.hasGoogle && (
        <form class="stack" onSubmit={(e) => { e.preventDefault(); void addEmail(email).then(setResult); }}>
          <label>Add an email
            <input name="email" type="email" autocomplete="email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
          </label>
          <button disabled={!email.trim()}>Send confirmation link</button>
          <p class="muted small-note">It lets you reset your password. It's optional.</p>
        </form>
      )}

      {!auth.username && (
        <div>
          <h3>Add a username and password</h3>
          <Credentials submitLabel="Save username and password" newPassword onSubmit={addUsernameAndPassword} />
        </div>
      )}

      {auth.hasPassword && (
        <form class="stack" onSubmit={(e) => { e.preventDefault(); void changePassword(newPassword).then((r) => { setResult(r); if (!r.error) setNewPassword(''); }); }}>
          <label>New password
            <input name="new-password" type="password" autocomplete="new-password" value={newPassword} onInput={(e) => setNewPassword((e.target as HTMLInputElement).value)} />
          </label>
          <button disabled={!newPassword}>Change password</button>
        </form>
      )}

      <Notice result={result} />

      <div class="row">
        <button onClick={() => void signOutUser()}>Sign out</button>
        {!confirming && <button class="plain" onClick={() => setConfirming(true)}>Delete account</button>}
      </div>
      {confirming && (
        <div class="row">
          <span>Delete your account, rank, and online progress for good?</span>
          <button class="danger" onClick={() => void deleteAccount().then((r) => { setConfirming(false); setResult(r.error ? r : { message: 'Your account was deleted.' }); })}>Delete for good</button>
          <button onClick={() => setConfirming(false)}>Keep my account</button>
        </div>
      )}
    </div>
  );
}
