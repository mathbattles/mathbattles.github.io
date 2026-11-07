import { MIN_PASSWORD, rankFor } from '@mathbattles/sim';
import { useEffect, useState } from 'preact/hooks';
import {
  addEmail,
  addPassword,
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
import { profile, saveProfile } from '../store';
import { Dropdown } from './Dropdown';
import { TopBar, useProfile } from './Shared';

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

/**
 * Asks for a birth year before an account is made, without hinting at the right answer.
 * Only "13 or older" or "under 13" is kept, on this device. Under 13 can keep playing as a guest.
 */
function AgeCheck() {
  const [year, setYear] = useState<number | null>(null);
  const now = new Date().getFullYear();
  const years = Array.from({ length: 100 }, (_, i) => now - i);
  const confirm = () => {
    if (year === null) return;
    // Someone born this year minus 13 might not have had their birthday yet, so they count as under 13.
    profile.ageBand = now - year > 13 ? 'adult' : 'child';
    if (profile.ageBand === 'child') profile.analytics = 'no';
    saveProfile();
  };
  return (
    <div class="sheet age-check">
      <h3>Before you make an account</h3>
      <p>What year were you born?</p>
      <div class="row">
        <Dropdown label="Birth year" value={year} placeholder="Choose a year" onChange={setYear} options={years.map((y) => ({ value: y, label: String(y) }))} />
        <button class="primary" disabled={year === null} onClick={confirm}>Continue</button>
      </div>
      <p class="muted small-note">We only keep whether you're 13 or older, on this device. Your birth year isn't saved or sent anywhere.</p>
    </div>
  );
}

function UnderThirteen() {
  return (
    <div class="age-check">
      <p><strong>Accounts are for players 13 and older.</strong></p>
      <p>You can still play everything as a guest: bots, Free Play, the campaign, Learn, custom maps, and online matches. Your progress stays on this device.</p>
      <a class="btn primary" href="#/">Keep playing</a>
    </div>
  );
}

export function SignIn() {
  useProfile();
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
        {mode === 'new' && !profile.ageBand && <AgeCheck />}
        {mode === 'new' && profile.ageBand === 'child' && <UnderThirteen />}
        {mode === 'new' && profile.ageBand === 'adult' && <Credentials key="new" submitLabel="Create account" newPassword onSubmit={register} />}
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
        {profile.ageBand === 'adult' ? (
          <button onClick={() => void signIn()}>Sign in with Google</button>
        ) : profile.ageBand === 'child' ? (
          <p class="muted">Google sign-in can make a new account, so it's for players 13 and older.</p>
        ) : (
          <button onClick={() => setMode('new')}>Sign in with Google</button>
        )}
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
  const [currentPassword, setCurrentPassword] = useState('');
  const [addedPassword, setAddedPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (task: Promise<AuthResult>) => {
    setBusy(true);
    const r = await task;
    setResult(r);
    setBusy(false);
    return r;
  };

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

      {auth.username && !auth.hasPassword && (
        <form class="stack" onSubmit={(e) => { e.preventDefault(); void run(addPassword(addedPassword)).then((r) => { if (!r.error) setAddedPassword(''); }); }}>
          <h3>Add a password</h3>
          <p class="muted small-note">Then you can sign in with your username, <strong>{auth.username}</strong>, and this password, as well as with Google.</p>
          <input type="hidden" name="username" autocomplete="username" value={auth.username} />
          <label>Password
            <input name="new-password" type="password" autocomplete="new-password" value={addedPassword} onInput={(e) => setAddedPassword((e.target as HTMLInputElement).value)} />
          </label>
          <button class="primary" disabled={busy || addedPassword.length < MIN_PASSWORD}>{busy ? 'One moment' : 'Add password'}</button>
          <p class="muted small-note">At least {MIN_PASSWORD} characters.</p>
        </form>
      )}

      {auth.hasPassword && (
        <form class="stack" onSubmit={(e) => { e.preventDefault(); void run(changePassword(newPassword, currentPassword || undefined)).then((r) => { if (!r.error) { setNewPassword(''); setCurrentPassword(''); } }); }}>
          <h3>Change password</h3>
          {!auth.hasGoogle && (
            <label>Current password
              <input name="current-password" type="password" autocomplete="current-password" value={currentPassword} onInput={(e) => setCurrentPassword((e.target as HTMLInputElement).value)} />
            </label>
          )}
          <label>New password
            <input name="new-password" type="password" autocomplete="new-password" value={newPassword} onInput={(e) => setNewPassword((e.target as HTMLInputElement).value)} />
          </label>
          <button disabled={busy || !newPassword}>Change password</button>
        </form>
      )}

      <Notice result={result} />

      <div class="row">
        <button onClick={() => void signOutUser()}>Sign out</button>
        {!confirming && <button class="plain" onClick={() => setConfirming(true)}>Delete account</button>}
      </div>
      {confirming && (
        <div class="stack">
          <span>Delete your account, rank, and online progress for good?</span>
          {auth.hasPassword && !auth.hasGoogle && (
            <label>Your password, to confirm
              <input name="confirm-password" type="password" autocomplete="current-password" value={currentPassword} onInput={(e) => setCurrentPassword((e.target as HTMLInputElement).value)} />
            </label>
          )}
          <div class="row">
            <button class="danger" disabled={busy} onClick={() => void run(deleteAccount(currentPassword || undefined)).then((r) => { if (!r.error) { setConfirming(false); setResult({ message: 'Your account was deleted.' }); setCurrentPassword(''); } })}>Delete for good</button>
            <button onClick={() => setConfirming(false)}>Keep my account</button>
          </div>
        </div>
      )}
    </div>
  );
}
