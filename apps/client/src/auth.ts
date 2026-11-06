import { useEffect, useState } from 'preact/hooks';
import { mergeCloud, profile, saveProfile, setSyncHook, type Profile } from './store';
import { pullProfile, pushProfile } from './net/api';

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

export interface AuthState {
  user: { uid: string; displayName: string | null } | null;
  token: string | null;
  rating: number | null;
  error: string;
}

export const authState: AuthState = { user: null, token: null, rating: null, error: '' };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function useAuth(): AuthState {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  return authState;
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
    known = localStorage.getItem('mathbattles.signedIn') === '1';
  } catch {
    /* no storage */
  }
  if (known) await watchAuth();
  if (profile.analytics === 'yes') void startAnalytics();
}

let watching = false;
async function watchAuth(): Promise<void> {
  if (watching) return;
  watching = true;
  const { auth, mod } = await getAuthApi();
  mod.onIdTokenChanged(auth, async (user) => {
    if (!user) {
      authState.user = null;
      authState.token = null;
      authState.rating = null;
      setSyncHook(null);
      emit();
      return;
    }
    authState.user = { uid: user.uid, displayName: user.displayName };
    authState.token = await user.getIdToken();
    emit();
    const cloud = await pullProfile(authState.token);
    if (cloud) {
      authState.rating = cloud.rating;
      if (cloud.profile) mergeCloud(cloud.profile as Partial<Profile>);
    }
    let pending = 0;
    setSyncHook((p) => {
      clearTimeout(pending);
      pending = window.setTimeout(() => {
        if (authState.token) void pushProfile(authState.token, p);
      }, 2000);
    });
    emit();
  });
}

export async function signIn(): Promise<void> {
  authState.error = '';
  try {
    await watchAuth();
    const { auth, mod } = await getAuthApi();
    await mod.signInWithPopup(auth, new mod.GoogleAuthProvider());
    try {
      localStorage.setItem('mathbattles.signedIn', '1');
    } catch {
      /* no storage */
    }
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    authState.error =
      code === 'auth/popup-closed-by-user' ? 'Sign-in was closed before it finished.' :
      code === 'auth/popup-blocked' ? 'Your browser blocked the sign-in window. Allow pop-ups and try again.' :
      code === 'auth/unauthorized-domain' || code === 'auth/operation-not-allowed' ? "Google sign-in isn't set up for this site yet." :
      "Sign-in didn't work. Try again.";
    emit();
  }
}

export async function signOutUser(): Promise<void> {
  const { auth, mod } = await getAuthApi();
  await mod.signOut(auth);
  try {
    localStorage.removeItem('mathbattles.signedIn');
  } catch {
    /* no storage */
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
