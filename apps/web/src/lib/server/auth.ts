import "server-only";
import { ensurePersonalOrganization, schema } from "@consyrion/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { getDb } from "./db";

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

function createAuth(db: Awaited<ReturnType<typeof getDb>>) {
  return betterAuth({
    appName: "CONSYRION AI",
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
    }),
    emailAndPassword: { enabled: true, minPasswordLength: 12 },
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
