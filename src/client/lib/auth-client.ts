import { anonymousClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// Dev-only: anonymous sign-in. Stripped from production builds by Vite's
// dead-code elimination on import.meta.env.DEV.
const devPlugins = import.meta.env.DEV ? [anonymousClient()] : [];

export const authClient = createAuthClient({
  baseURL: window.location.origin,
  plugins: devPlugins,
});

export const IS_DEV = import.meta.env.DEV;
export const { useSession, signIn, signOut } = authClient;
