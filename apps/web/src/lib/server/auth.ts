import "server-only";
import { ensurePersonalOrganization, markEmailVerifiedAfterPasswordReset, schema } from "@consyrium/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { getDb } from "./db";
import {
  emailVerificationEnabled,
  PASSWORD_RESET_LINK_MINUTES,
  passwordResetEnabled as passwordResetConfigured,
  sendPasswordResetMail,
  sendVerificationMail,
  VERIFICATION_LINK_HOURS,
} from "./email-verification";

/** Social login providers are enabled only when their OAuth credentials are configured. */
const socialProviders = {
  ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? { google: { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, prompt: "select_account" as const } }
    : {}),
  ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
    ? { github: { clientId: process.env.GITHUB_CLIENT_ID, clientSecret: process.env.GITHUB_CLIENT_SECRET } }
    : {}),
};

export const enabledSocialProviders = Object.keys(socialProviders) as Array<"google" | "github">;

/** E-mail verification is required whenever SMTP is configured (see email-verification.ts). */
export const emailVerificationRequired = emailVerificationEnabled();

/** "Forgot password" works whenever SMTP is configured (#395). */
export const passwordResetEnabled = passwordResetConfigured();

function createAuth(db: Awaited<ReturnType<typeof getDb>>) {
  return betterAuth({
    appName: "CONSYRIUM AI",
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      requireEmailVerification: emailVerificationRequired,
      // Password reset (#395): the link is valid once for one hour, every other session ends, and the address counts as
      // verified because the link reached it. Without SMTP there is no reset (nobody could receive the link).
      ...(passwordResetEnabled
        ? {
            resetPasswordTokenExpiresIn: PASSWORD_RESET_LINK_MINUTES * 60,
            revokeSessionsOnPasswordReset: true,
            sendResetPassword: async ({ user, url }: { user: { email: string; name: string }; url: string }) => {
              await sendPasswordResetMail({ to: user.email, name: user.name, url });
            },
            onPasswordReset: async ({ user }: { user: { id: string } }) => {
              await markEmailVerifiedAfterPasswordReset(db, user.id);
            },
          }
        : {}),
    },
    // Unverified accounts cannot sign in; every sign-in attempt sends a fresh link. The link only verifies the address –
    // it never opens a session (whoever gets hold of the e-mail must still know the password).
    ...(emailVerificationRequired
      ? {
          emailVerification: {
            sendOnSignUp: true,
            sendOnSignIn: true,
            autoSignInAfterVerification: false,
            expiresIn: VERIFICATION_LINK_HOURS * 60 * 60,
            sendVerificationEmail: async ({ user, url }: { user: { email: string; name: string }; url: string }) => {
              await sendVerificationMail({ to: user.email, name: user.name, url });
            },
          },
        }
      : {}),
    socialProviders,
    // Signed-in users may connect further sign-in methods (Settings → Account). Different e-mail addresses are
    // allowed only for this explicit linking by the account owner. Sign-in never merges accounts by itself
    // (`disableImplicitLinking`, #395): otherwise a Google/GitHub login would land in an account somebody else
    // pre-registered with the same address and still knows the password of.
    account: { accountLinking: { enabled: true, allowDifferentEmails: true, disableImplicitLinking: true } },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    databaseHooks: {
      user: {
        create: {
          after: async (created) => {
            await ensurePersonalOrganization(await getDb(), created.id, created.name);
          },
        },
      },
    },
    // Built-in limiter for sign-in/sign-up (enabled in production by default; explicit here).
    rateLimit: { enabled: process.env.NODE_ENV === "production", window: 60, max: 30 },
    plugins: [nextCookies()],
  });
}

let instance: ReturnType<typeof createAuth> | undefined;

/** Better Auth is created lazily after the database is ready (see db.ts). */
export async function getAuth() {
  instance ??= createAuth(await getDb());
  return instance;
}
