import { MIN_PASSWORD, loginEmailFor, usernameProblem } from '@mathbattles/sim';
import { useEffect, useState } from 'preact/hooks';
import { claimUsername, deleteAccountData, pullProfile, pushProfile, resolveLogin, saveLoginEmail, usernameAvailable } from './net/api';
import { mergeCloud, profile, saveProfile, setSyncHook, type Profile } from './store';

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
  if (profile.analytics === 'yes') void startAnalytics();
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
          // Tokens refresh about hourly; only load the cloud profile once per login.
          if (loadedFor !== user.uid) {
            loadedFor = user.uid;
            await loadCloud(authState.token);
          }
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

async function loadCloud(token: string): Promise<void> {
  setSyncHook(null);
  const cloud = await pullProfile(token);
  if (cloud) {
    authState.rating = cloud.rating;
    authState.username = cloud.username;
    if (cloud.profile) mergeCloud(cloud.profile as Partial<Profile>);
    if (cloud.username && profile.name !== cloud.username) {
      profile.name = cloud.username;
      saveProfile();
    }
  }
  let pending = 0;
  setSyncHook((p) => {
    clearTimeout(pending);
    pending = window.setTimeout(() => {
      if (authState.token) void pushProfile(authState.token, p);
    }, 2000);
  });
  // First sign-in on this account: keep what the player earned as a guest.
  if (cloud && !cloud.profile && authState.token) void pushProfile(authState.token, profile);
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
    const cred = await mod.createUserWithEmailAndPassword(auth, loginEmailFor(username), password);
    created = cred.user;
    const claim = await claimUsername(await created.getIdToken(), username);
    if (!claim.username) {
      // Don't leave behind a login without a username.
      await created.delete().catch(() => {});
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
  try {
    await mod.signInWithEmailAndPassword(auth, loginEmailFor(username.trim()), password);
    rememberSignedIn(true);
    return {};
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    const wrong = ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-login-credentials', 'auth/invalid-email'];
    if (!wrong.includes(code)) return { error: errorText(e) };
  }
  // This account may have moved to a real email.
  const found = await resolveLogin(username.trim(), password);
  if (!found) return { error: 'Wrong username or password.' };
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
    await mod.signInWithPopup(auth, new mod.GoogleAuthProvider());
    rememberSignedIn(true);
  } catch (e) {
    authState.error = errorText(e);
    emit();
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
  const { auth, mod } = await getAuthApi();
  const user = auth.currentUser;
  if (!user) return { error: 'Sign in first.' };
  const claim = await claimUsername(await user.getIdToken(), username);
  if (!claim.username) return { error: claim.error ?? 'That username is taken.' };
  const finish = () => {
    authState.username = claim.username!;
    profile.name = claim.username!;
    saveProfile();
  };
  try {
    // A Google account's own email stays its login, so the server keeps that for username sign-in.
    const email = user.email ?? user.providerData.find((p) => p.email)?.email;
    if (!email) return { error: 'This account has no email to attach a password to.' };
    await mod.linkWithCredential(user, mod.EmailAuthProvider.credential(email, password));
    await saveLoginEmail(await user.getIdToken(), email);
    finish();
    await refreshAfterChange();
    return { message: 'Username and password added.' };
  } catch (e) {
    finish();
    return { error: `Your username is saved, but the password wasn't: ${errorText(e)}` };
  }
}

/** Adds a real email. Firebase mails a link, and the address takes effect once it's clicked. */
export async function addEmail(email: string): Promise<AuthResult> {
  const { auth, mod } = await getAuthApi();
  const user = auth.currentUser;
  if (!user) return { error: 'Sign in first.' };
  try {
    await mod.verifyBeforeUpdateEmail(user, email.trim());
    const saved = await saveLoginEmail(await user.getIdToken(), email.trim());
    if (!saved) return { error: "The link was sent, but the game server didn't respond. Try again." };
    return { message: `Check ${email.trim()} and click the link to finish. You'll keep signing in with your username.` };
  } catch (e) {
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
  await mod.signOut(auth);
  rememberSignedIn(false);
}

/** Permanently removes the account and its online data. Progress on this device stays. */
export async function deleteAccount(): Promise<AuthResult> {
  const { auth } = await getAuthApi();
  const user = auth.currentUser;
  if (!user) return { error: 'Sign in first.' };
  try {
    // Firebase checks for a recent login first, so server data isn't removed if this refuses.
    await user.getIdToken(true);
    const token = await user.getIdToken();
    const uid = user.uid;
    await user.delete();
    const removed = await deleteAccountData(token);
    rememberSignedIn(false);
    return removed ? {} : { error: `Your login was deleted, but the game server didn't confirm removing data for ${uid}.` };
  } catch (e) {
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
  profile.analytics = yes ? 'yes' : 'no';
  saveProfile();
  if (yes) void startAnalytics();
  else if (analyticsStarted) {
    void Promise.all([app(), import('firebase/analytics')]).then(([a, mod]) => mod.setAnalyticsCollectionEnabled(mod.getAnalytics(a), false));
  }
}
