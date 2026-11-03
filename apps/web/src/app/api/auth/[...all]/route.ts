import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/server/auth";

async function handler(request: Request) {
  const { GET, POST } = toNextJsHandler(await getAuth());
  return request.method === "GET" ? GET(request) : POST(request);
}

export { handler as GET, handler as POST };
