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
import { t } from '../i18n';

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
      <h3>{t('ui.beforeYouMakeAnAccount')}</h3>
      <p>{t('ui.whatYearWereYouBorn')}</p>
      <div class="row">
        <Dropdown label={t('ui.birthYear')} value={year} placeholder={t('ui.chooseAYear')} onChange={setYear} options={years.map((y) => ({ value: y, label: String(y) }))} />
        <button class="primary" disabled={year === null} onClick={confirm}>{t('ui.continue')}</button>
      </div>
      <p class="muted small-note">{t('ui.weOnlyKeepWhetherYouRe')}</p>
    </div>
  );
}

function UnderThirteen() {
  return (
    <div class="age-check">
      <p><strong>{t('ui.accountsAreForPlayers13And')}</strong></p>
      <p>{t('ui.youCanStillPlayEverythingAs')}</p>
      <a class="btn primary" href="#/">{t('ui.keepPlaying')}</a>
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
      <TopBar title={t('ui.signIn')} />
      <div class="sheet">
        <div class="row tabs" role="group" aria-label={t('ui.signInOrCreateAnAccount')}>
          <button class={mode === 'in' ? 'on' : ''} aria-pressed={mode === 'in'} onClick={() => setMode('in')}>{t('ui.signIn')}</button>
          <button class={mode === 'new' ? 'on' : ''} aria-pressed={mode === 'new'} onClick={() => setMode('new')}>{t('ui.createAccount')}</button>
        </div>
        {mode === 'in' && <Credentials key="in" submitLabel="Sign in" newPassword={false} onSubmit={signInWithUsername} />}
        {mode === 'new' && !profile.ageBand && <AgeCheck />}
        {mode === 'new' && profile.ageBand === 'child' && <UnderThirteen />}
        {mode === 'new' && profile.ageBand === 'adult' && <Credentials key="new" submitLabel="Create account" newPassword onSubmit={register} />}
        {mode === 'forgot' && (
          <form class="stack" onSubmit={(e) => { e.preventDefault(); void resetPassword(email).then(setForgot); }}>
            <p>{t('ui.enterTheEmailYouAddedTo')}</p>
            <label>Email
              <input name="email" type="email" autocomplete="email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
            </label>
            <button class="primary">{t('ui.sendResetLink')}</button>
            <Notice result={forgot} />
            <p class="muted small-note">{t('ui.noEmailOnYourAccountIf')}</p>
          </form>
        )}
        <div class="row" style={{ marginTop: 14 }}>
          {mode !== 'forgot' && <button class="plain" onClick={() => setMode('forgot')}>{t('ui.forgotYourPassword')}</button>}
          {mode === 'forgot' && <button class="plain" onClick={() => setMode('in')}>{t('ui.backToSignIn')}</button>}
        </div>
      </div>
      <div class="sheet">
        <h3>{t('ui.orUseGoogle')}</h3>
        {profile.ageBand === 'adult' ? (
          <button onClick={() => void signIn()}>{t('ui.signInWithGoogle')}</button>
        ) : profile.ageBand === 'child' ? (
          <p class="muted">{t('ui.googleSignInCanMakeA')}</p>
        ) : (
          <button onClick={() => setMode('new')}>{t('ui.signInWithGoogle')}</button>
        )}
        {auth.error && <p class="error" role="alert">{auth.error}</p>}
        <p class="muted small-note" style={{ marginTop: 10 }}>{t('ui.youCanAlsoKeepPlayingAs')}</p>
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

  if (!auth.ready) return <p>{t('ui.checkingYourAccount')}</p>;
  if (!auth.user) {
    return (
      <>
        <p>{t('ui.youRePlayingAsAGuest')}</p>
        <a class="btn primary" href="#/signin">{t('ui.signInOrCreateAnAccount')}</a>
      </>
    );
  }
  return (
    <div class="stack">
      <p>{t('ui.signedInAs')} <strong>{auth.username ?? auth.user.displayName ?? 'your account'}</strong>{t('ui.yourProgressSyncsAcrossDevices')}</p>
      {auth.rating !== null && <p>Rank: {rankFor(auth.rating)}</p>}

      {auth.hasGoogle ? <p class="ok">{t('ui.googleIsLinked')}</p> : (
        <div>
          <button onClick={() => void linkGoogle().then(setResult)}>{t('ui.addAGoogleAccount')}</button>
          <p class="muted small-note">{t('ui.thenYouCanSignInWith')}</p>
        </div>
      )}

      {auth.email ? <p class="ok">Email on this account: {auth.email}</p> : !auth.hasGoogle && (
        <form class="stack" onSubmit={(e) => { e.preventDefault(); void addEmail(email).then(setResult); }}>
          <label>Add an email
            <input name="email" type="email" autocomplete="email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
          </label>
          <button disabled={!email.trim()}>{t('ui.sendConfirmationLink')}</button>
          <p class="muted small-note">{t('ui.itLetsYouResetYourPassword')}</p>
        </form>
      )}

      {!auth.username && (
        <div>
          <h3>{t('ui.addAUsernameAndPassword')}</h3>
          <Credentials submitLabel="Save username and password" newPassword onSubmit={addUsernameAndPassword} />
        </div>
      )}

      {auth.username && !auth.hasPassword && (
        <form class="stack" onSubmit={(e) => { e.preventDefault(); void run(addPassword(addedPassword)).then((r) => { if (!r.error) setAddedPassword(''); }); }}>
          <h3>{t('ui.addAPassword')}</h3>
          <p class="muted small-note">{t('ui.thenYouCanSignInWith2')} <strong>{auth.username}</strong>{t('ui.andThisPasswordAsWellAs')}</p>
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
          <h3>{t('ui.changePassword')}</h3>
          {!auth.hasGoogle && (
            <label>Current password
              <input name="current-password" type="password" autocomplete="current-password" value={currentPassword} onInput={(e) => setCurrentPassword((e.target as HTMLInputElement).value)} />
            </label>
          )}
          <label>New password
            <input name="new-password" type="password" autocomplete="new-password" value={newPassword} onInput={(e) => setNewPassword((e.target as HTMLInputElement).value)} />
          </label>
          <button disabled={busy || !newPassword}>{t('ui.changePassword')}</button>
        </form>
      )}

      <Notice result={result} />

      <div class="row">
        <button onClick={() => void signOutUser()}>{t('ui.signOut')}</button>
        {!confirming && <button class="plain" onClick={() => setConfirming(true)}>{t('ui.deleteAccount')}</button>}
      </div>
      {confirming && (
        <div class="stack">
          <span>{t('ui.deleteYourAccountRankAndOnline')}</span>
          {auth.hasPassword && !auth.hasGoogle && (
            <label>Your password, to confirm
              <input name="confirm-password" type="password" autocomplete="current-password" value={currentPassword} onInput={(e) => setCurrentPassword((e.target as HTMLInputElement).value)} />
            </label>
          )}
          <div class="row">
            <button class="danger" disabled={busy} onClick={() => void run(deleteAccount(currentPassword || undefined)).then((r) => { if (!r.error) { setConfirming(false); setResult({ message: 'Your account was deleted.' }); setCurrentPassword(''); } })}>{t('ui.deleteForGood')}</button>
            <button onClick={() => setConfirming(false)}>{t('ui.keepMyAccount')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
