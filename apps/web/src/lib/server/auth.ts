import "server-only";
import { ensurePersonalOrganization, schema } from "@consyrion/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { getDb } from "./db";
import { emailVerificationEnabled, sendVerificationMail, VERIFICATION_LINK_HOURS } from "./email-verification";

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

function createAuth(db: Awaited<ReturnType<typeof getDb>>) {
  return betterAuth({
    appName: "CONSYRION AI",
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
    }),
    emailAndPassword: { enabled: true, minPasswordLength: 12, requireEmailVerification: emailVerificationRequired },
    // Unverified accounts cannot sign in; every sign-in attempt sends a fresh link, the link signs the user in.
    ...(emailVerificationRequired
      ? {
          emailVerification: {
            sendOnSignUp: true,
            sendOnSignIn: true,
            autoSignInAfterVerification: true,
            expiresIn: VERIFICATION_LINK_HOURS * 60 * 60,
            sendVerificationEmail: async ({ user, url }: { user: { email: string; name: string }; url: string }) => {
              await sendVerificationMail({ to: user.email, name: user.name, url });
            },
          },
        }
      : {}),
    socialProviders,
    // Signed-in users may connect further sign-in methods (Settings → Account). Different e-mail addresses are
    // allowed only for this explicit linking by the account owner; sign-in never merges accounts by itself.
    account: { accountLinking: { enabled: true, allowDifferentEmails: true } },
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
