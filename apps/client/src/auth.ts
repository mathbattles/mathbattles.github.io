import { MIN_PASSWORD, loginEmailFor, usernameProblem } from '@mathbattles/sim';
import { useEffect, useState } from 'preact/hooks';
import { claimUsername, deleteAccountData, pullProfile, pushProfile, resolveLogin, syncEmail, usernameAvailable } from './net/api';
import { uploadPending } from './history';
import { mergeCloud, profile, releaseOwner, resetToGuest, saveProfile, setSyncHook, type Profile } from './store';

/** This config identifies the Firebase project and is meant to be public. */
const firebaseConfig = {
  apiKey: 'AIzaSyAEpVeNtZMpX-mj_iVvGJ0Fmy_1XhBGCKQ',
  authDomain: 'mathbattles-98eee.firebaseapp.com',
  projectId: 'mathbattles-98eee',
  storageBucket: 'mathbattles-98eee.firebasestorage.app',
  messagingSenderId: '813687836757',
  appId: '1:813687836757:web:e4f5c4438fc5cc56d984dc',
  measurementId: 'G-VXBP3KB0WV',
};

const PRIVATE_DOMAIN = '@users.mathbattles.invalid';

export interface AuthState {
  /** False until any saved login has finished loading. */
  ready: boolean;
  user: { uid: string; displayName: string | null } | null;
  username: string | null;
  hasPassword: boolean;
  hasGoogle: boolean;
  /** A real email on the account, if one has been added. */
  email: string | null;
  token: string | null;
  rating: number | null;
  error: string;
}

export const authState: AuthState = {
  ready: false, user: null, username: null, hasPassword: false, hasGoogle: false, email: null, token: null, rating: null, error: '',
};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Calls fn whenever sign-in state changes, outside of components. */
export function subscribeAuth(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useAuth(): AuthState {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    // Auth may have changed before this listener existed.
    fn();
    return () => listeners.delete(fn);
  }, []);
  return authState;
}

const SIGNED_IN_KEY = 'mathbattles.signedIn';

function rememberSignedIn(yes: boolean): void {
  try {
    if (yes) localStorage.setItem(SIGNED_IN_KEY, '1');
    else localStorage.removeItem(SIGNED_IN_KEY);
  } catch {
    /* no storage */
  }
}

let appPromise: Promise<import('firebase/app').FirebaseApp> | null = null;
function app() {
  appPromise ??= import('firebase/app').then(({ initializeApp }) => initializeApp(firebaseConfig));
  return appPromise;
}

async function getAuthApi() {
  const [a, mod] = await Promise.all([app(), import('firebase/auth')]);
  return { auth: mod.getAuth(a), mod };
}

/** Sets up auth only for people who have signed in before, so guests never load Firebase. */
export async function initAuth(): Promise<void> {
  void retryPendingDelete();
  let known = false;
  try {
    known = localStorage.getItem(SIGNED_IN_KEY) === '1';
  } catch {
    /* no storage */
  }
  if (known) await watchAuth();
  else {
    authState.ready = true;
    emit();
  }
  if (profile.analytics === 'yes' && profile.ageBand !== 'child') void startAnalytics();
}

function readProviders(user: import('firebase/auth').User): void {
  authState.user = { uid: user.uid, displayName: user.displayName };
  const ids = user.providerData.map((p) => p.providerId);
  authState.hasPassword = ids.includes('password');
  authState.hasGoogle = ids.includes('google.com');
  const email = user.email ?? user.providerData.find((p) => p.email)?.email ?? null;
  authState.email = email && !email.endsWith(PRIVATE_DOMAIN) ? email : null;
}

let watching: Promise<void> | null = null;
let loadedFor: string | null = null;

function watchAuth(): Promise<void> {
  watching ??= (async () => {
    const { auth, mod } = await getAuthApi();
    await new Promise<void>((settled) => {
      mod.onIdTokenChanged(auth, async (user) => {
        try {
          if (!user) {
            Object.assign(authState, { user: null, username: null, token: null, rating: null, hasPassword: false, hasGoogle: false, email: null });
            loadedFor = null;
            setSyncHook(null);
            return;
          }
          readProviders(user);
          authState.token = await user.getIdToken();
          // Tokens refresh about hourly; load the cloud profile once per login, and retry if it failed.
          if (loadedFor !== user.uid && (await loadCloud(user.uid, authState.token))) loadedFor = user.uid;
        } finally {
          authState.ready = true;
          emit();
          settled();
        }
      });
    });
  })();
  return watching;
}

let pendingPush = 0;

async function loadCloud(uid: string, token: string): Promise<boolean> {
  setSyncHook(null);
  const cloud = await pullProfile(token);
  // Without the cloud copy, nothing is synced: an upload now could overwrite newer progress.
  if (!cloud) return false;
  authState.rating = cloud.rating;
  // A brand-new account's claim may have finished while this was loading.
  authState.username = cloud.username ?? authState.username;
  mergeCloud(uid, cloud.profile as Partial<Profile> | null);
  if (authState.username && profile.name !== authState.username) {
    profile.name = authState.username;
    saveProfile();
  }
  setSyncHook((p) => {
    clearTimeout(pendingPush);
    pendingPush = window.setTimeout(() => {
      if (authState.token) void pushProfile(authState.token, p);
    }, 2000);
  });
  // Combined progress may differ from both copies, so save the result.
  void pushProfile(token, profile);
  void syncEmail(token);
  // Matches played as a guest come along, the same way guest progress does.
  void uploadPending(token);
  return true;
}

function errorText(e: unknown): string {
  const code = (e as { code?: string }).code ?? '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-login-credentials':
      return 'Wrong username or password.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes and try again.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Sign-in was closed before it finished.';
    case 'auth/popup-blocked':
      return 'Your browser blocked the sign-in window. Allow pop-ups and try again.';
    case 'auth/unauthorized-domain':
      return "Google sign-in isn't set up for this site yet.";
    case 'auth/operation-not-allowed':
      return "This sign-in method isn't turned on yet.";
    case 'auth/email-already-in-use':
      return 'That username or email is already in use.';
    case 'auth/credential-already-in-use':
      return 'That Google account already has its own MathBattles account.';
    case 'auth/provider-already-linked':
      return 'This account already has that sign-in method.';
    case 'auth/weak-password':
    case 'auth/password-does-not-meet-requirements':
      return `Choose a stronger password, with at least ${MIN_PASSWORD} characters.`;
    case 'auth/invalid-email':
      return 'That email address looks wrong.';
    case 'auth/requires-recent-login':
      return 'For safety, sign out and sign back in, then try again.';
    case 'auth/network-request-failed':
      return "Can't reach the sign-in service. Check your connection.";
    default:
      return "That didn't work. Try again.";
  }
}

export interface AuthResult {
  error?: string;
  message?: string;
}

function checkNewCredentials(username: string, password: string): string | null {
  const problem = usernameProblem(username);
  if (problem) return problem;
  if (password.length < MIN_PASSWORD) return `Passwords need at least ${MIN_PASSWORD} characters.`;
  return null;
}

async function refreshAfterChange(): Promise<void> {
  const { auth } = await getAuthApi();
  if (!auth.currentUser) return;
  await auth.currentUser.reload();
  readProviders(auth.currentUser);
  authState.token = await auth.currentUser.getIdToken(true);
  emit();
}

export async function register(username: string, password: string): Promise<AuthResult> {
  const bad = checkNewCredentials(username, password);
  if (bad) return { error: bad };
  const free = await usernameAvailable(username);
  if (!free) return { error: "The game server isn't reachable. Try again soon." };
  if (!free.available) return { error: free.problem ?? 'That username is taken.' };
  let created: import('firebase/auth').User | null = null;
  try {
    await watchAuth();
    const { auth, mod } = await getAuthApi();
    let isNew = true;
    try {
      created = (await mod.createUserWithEmailAndPassword(auth, loginEmailFor(username), password)).user;
    } catch (e) {
      if ((e as { code?: string }).code !== 'auth/email-already-in-use') throw e;
      // A signup that stopped halfway can be finished with the same password.
      isNew = false;
      try {
        created = (await mod.signInWithEmailAndPassword(auth, loginEmailFor(username), password)).user;
      } catch {
        return { error: 'That username is taken.' };
      }
    }
    const claim = await claimUsername(await created.getIdToken(), username);
    if (!claim.username) {
      // Don't leave behind a login without a username.
      if (isNew) await created.delete().catch(() => {});
      else await mod.signOut(auth);
      return { error: claim.error ?? 'That username is taken.' };
    }
    authState.username = claim.username;
    profile.name = claim.username;
    saveProfile();
    rememberSignedIn(true);
    emit();
    return {};
  } catch (e) {
    return { error: errorText(e) };
  }
}

export async function signInWithUsername(username: string, password: string): Promise<AuthResult> {
  if (!username.trim() || !password) return { error: 'Enter your username and password.' };
  await watchAuth();
  const { auth, mod } = await getAuthApi();
  const isEmail = username.includes('@');
  try {
    await mod.signInWithEmailAndPassword(auth, isEmail ? username.trim() : loginEmailFor(username.trim()), password);
    rememberSignedIn(true);
    return {};
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    const wrong = ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-login-credentials', 'auth/invalid-email'];
    if (isEmail || !wrong.includes(code)) return { error: errorText(e) };
  }
  // This account may have moved to a real email.
  const found = await resolveLogin(username.trim(), password);
  if (!found.email) return { error: found.error ? `${found.error.replace(/\.$/, '')}.` : 'Wrong username or password.' };
  try {
    await mod.signInWithEmailAndPassword(auth, found.email, password);
    rememberSignedIn(true);
    return {};
  } catch (e) {
    return { error: errorText(e) };
  }
}

export async function signIn(): Promise<void> {
  authState.error = '';
  try {
    await watchAuth();
    const { auth, mod } = await getAuthApi();
    try {
      await mod.signInWithPopup(auth, new mod.GoogleAuthProvider());
    } catch (e) {
      // Some browsers block pop-ups. A full-page redirect works there, and comes back here.
      if ((e as { code?: string }).code !== 'auth/popup-blocked') throw e;
      rememberSignedIn(true);
      await mod.signInWithRedirect(auth, new mod.GoogleAuthProvider());
      return;
    }
    rememberSignedIn(true);
  } catch (e) {
    authState.error = errorText(e);
    emit();
  }
}

/**
 * Proves it's really you again, for changes Firebase protects with a recent sign-in.
 * Google accounts confirm in a pop-up; password accounts use the current password.
 */
async function reauthenticate(currentPassword?: string): Promise<void> {
  const { auth, mod } = await getAuthApi();
  const user = auth.currentUser;
  if (!user) throw Object.assign(new Error('Sign in first'), { code: 'auth/no-current-user' });
  const ids = user.providerData.map((p) => p.providerId);
  if (ids.includes('google.com')) {
    await mod.reauthenticateWithPopup(user, new mod.GoogleAuthProvider());
    return;
  }
  if (!currentPassword) throw Object.assign(new Error('Password needed'), { code: 'auth/requires-recent-login' });
  const email = user.email ?? user.providerData.find((p) => p.email)?.email;
  if (!email) throw Object.assign(new Error('No email'), { code: 'auth/requires-recent-login' });
  await mod.reauthenticateWithCredential(user, mod.EmailAuthProvider.credential(email, currentPassword));
}

/** Runs a protected change, confirming the sign-in first if Firebase asks for it. */
async function withRecentLogin<T>(task: () => Promise<T>, currentPassword?: string): Promise<T> {
  try {
    return await task();
  } catch (e) {
    if ((e as { code?: string }).code !== 'auth/requires-recent-login') throw e;
    await reauthenticate(currentPassword);
    return task();
  }
}

/** Adds Google as another way into the signed-in account. */
export async function linkGoogle(): Promise<AuthResult> {
  try {
    const { auth, mod } = await getAuthApi();
    if (!auth.currentUser) return { error: 'Sign in first.' };
    await mod.linkWithPopup(auth.currentUser, new mod.GoogleAuthProvider());
    await refreshAfterChange();
    return { message: 'Google is linked. You can now sign in with it too.' };
  } catch (e) {
    return { error: errorText(e) };
  }
}

/** Gives an account made with Google a username and password. */
export async function addUsernameAndPassword(username: string, password: string): Promise<AuthResult> {
  const bad = checkNewCredentials(username, password);
  if (bad) return { error: bad };
  const { auth } = await getAuthApi();
  const user = auth.currentUser;
  if (!user) return { error: 'Sign in first.' };
  if (!(user.email ?? user.providerData.find((p) => p.email)?.email)) return { error: 'This account has no email to attach a password to.' };
  // Saying the same username again is allowed, so this can be retried if the second step fails.
  const claim = await claimUsername(await user.getIdToken(), username);
  if (!claim.username) return { error: claim.error ?? 'That username is taken.' };
  authState.username = claim.username;
  profile.name = claim.username;
  saveProfile();
  const added = await addPassword(password);
  if (added.error) return { error: `Your username is saved. To finish, add a password below. (${added.error.replace(/\.$/, '')}.)` };
  return { message: 'Username and password added. You can now sign in with either one, or with Google.' };
}

/**
 * Adds a password to an account that only had Google. The password is tied to the account's
 * email, and the server is told that email, so signing in with the username works afterwards.
 */
export async function addPassword(password: string): Promise<AuthResult> {
  if (password.length < MIN_PASSWORD) return { error: `Passwords need at least ${MIN_PASSWORD} characters.` };
  const { auth, mod } = await getAuthApi();
  const user = auth.currentUser;
  if (!user) return { error: 'Sign in first.' };
  const email = user.email ?? user.providerData.find((p) => p.email)?.email;
  if (!email) return { error: 'This account has no email to attach a password to.' };
  try {
    await withRecentLogin(() => mod.linkWithCredential(user, mod.EmailAuthProvider.credential(email, password)));
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'auth/provider-already-linked') {
      // A password is already on the account: set it to the one just typed instead.
      try {
        await withRecentLogin(() => mod.updatePassword(user, password));
      } catch (err) {
        return { error: errorText(err) };
      }
    } else {
      return { error: errorText(e) };
    }
  }
  await refreshAfterChange();
  const synced = await syncEmail(await user.getIdToken(true));
  if (!synced?.ok) return { message: 'Password added. If signing in with your username fails, sign in with Google once and it will start working.' };
  return { message: 'Password added. You can now sign in with your username and password.' };
}

/** Adds a real email. Firebase mails a link, and the address takes effect once it's clicked. */
export async function addEmail(email: string): Promise<AuthResult> {
  const { auth, mod } = await getAuthApi();
  const user = auth.currentUser;
  if (!user) return { error: 'Sign in first.' };
  try {
    await mod.verifyBeforeUpdateEmail(user, email.trim());
    return { message: `Check ${email.trim()} and click the link. After that, sign in once using that email and your password. Then your username works again too.` };
  } catch (e) {
    return { error: errorText(e) };
  }
}

/** Sets a new password. Firebase wants a recent sign-in, so it confirms with Google or the current password. */
export async function changePassword(password: string, currentPassword?: string): Promise<AuthResult> {
  if (password.length < MIN_PASSWORD) return { error: `Passwords need at least ${MIN_PASSWORD} characters.` };
  const { auth, mod } = await getAuthApi();
  const user = auth.currentUser;
  if (!user) return { error: 'Sign in first.' };
  try {
    await withRecentLogin(() => mod.updatePassword(user, password), currentPassword);
    return { message: 'Your password was changed.' };
  } catch (e) {
    if ((e as { code?: string }).code === 'auth/requires-recent-login') return { error: 'Enter your current password too, to confirm it is you.' };
    return { error: errorText(e) };
  }
}

/** Sends a reset link. Only works for accounts with a real email. */
export async function resetPassword(email: string): Promise<AuthResult> {
  if (!email.trim()) return { error: 'Enter the email on your account.' };
  try {
    const { auth, mod } = await getAuthApi();
    await mod.sendPasswordResetEmail(auth, email.trim());
    return { message: 'If that email is on an account, a reset link is on its way.' };
  } catch (e) {
    return { error: errorText(e) };
  }
}

export async function signOutUser(): Promise<void> {
  const { auth, mod } = await getAuthApi();
  // Save first: the next step clears this device.
  clearTimeout(pendingPush);
  setSyncHook(null);
  if (authState.token && loadedFor) await pushProfile(authState.token, profile);
  await mod.signOut(auth);
  rememberSignedIn(false);
  resetToGuest();
}

const PENDING_DELETE_KEY = 'mathbattles.pendingDelete';

/** Finishes removing server data if the connection failed right after the login was deleted. */
async function retryPendingDelete(): Promise<void> {
  let token: string | null = null;
  try {
    token = localStorage.getItem(PENDING_DELETE_KEY);
  } catch {
    return;
  }
  if (token && (await deleteAccountData(token))) localStorage.removeItem(PENDING_DELETE_KEY);
}

/** Permanently removes the account and its online data. Progress on this device stays as a guest. */
export async function deleteAccount(currentPassword?: string): Promise<AuthResult> {
  const { auth } = await getAuthApi();
  const user = auth.currentUser;
  if (!user) return { error: 'Sign in first.' };
  try {
    const token = await user.getIdToken(true);
    // Firebase refuses without a recent login, and then nothing has been removed.
    await withRecentLogin(() => user.delete(), currentPassword);
    // Stop syncing, or a delayed save could recreate the data just deleted.
    clearTimeout(pendingPush);
    setSyncHook(null);
    rememberSignedIn(false);
    releaseOwner();
    let removed = await deleteAccountData(token);
    if (!removed) removed = await deleteAccountData(token);
    if (!removed) {
      try {
        localStorage.setItem(PENDING_DELETE_KEY, token);
      } catch {
        /* no storage */
      }
      return { error: 'Your login was deleted, but the server could not be reached to remove your data. Reopen the game soon to finish.' };
    }
    return {};
  } catch (e) {
    if ((e as { code?: string }).code === 'auth/requires-recent-login') return { error: 'Enter your password to confirm, then try again.' };
    return { error: errorText(e) };
  }
}

let analyticsStarted = false;
async function startAnalytics(): Promise<void> {
  if (analyticsStarted) return;
  analyticsStarted = true;
  try {
    const [a, mod] = await Promise.all([app(), import('firebase/analytics')]);
    if (await mod.isSupported()) mod.getAnalytics(a);
  } catch {
    /* analytics is optional */
  }
}

export function setAnalyticsConsent(yes: boolean): void {
  // Players under 13 never get analytics.
  if (profile.ageBand === 'child') yes = false;
  profile.analytics = yes ? 'yes' : 'no';
  saveProfile();
  if (yes) void startAnalytics();
  else if (analyticsStarted) {
    void Promise.all([app(), import('firebase/analytics')]).then(([a, mod]) => mod.setAnalyticsCollectionEnabled(mod.getAnalytics(a), false));
  }
}
