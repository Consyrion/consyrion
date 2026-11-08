/* global process, Buffer, URL, console */
// Test-only mail server for the auth E2E tests: accepts every message over SMTP (with the STARTTLS the app requires,
// on smtp-server's built-in self-signed certificate) and hands the messages to the tests over HTTP. Never used in
// production; it binds to 127.0.0.1 only.
import { createServer } from "node:http";
import { SMTPServer } from "smtp-server";

const SMTP_PORT = Number(process.env.E2E_SMTP_PORT ?? 2525);
const HTTP_PORT = Number(process.env.E2E_SMTP_HTTP_PORT ?? 2526);
const messages = [];

/** Undoes quoted-printable soft line breaks and escapes, so long links come out in one piece. */
function decodeQuotedPrintable(text) {
  return text.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

const smtp = new SMTPServer({
  authOptional: true,
  disabledCommands: ["AUTH"],
  logger: false,
  onData(stream, session, callback) {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const [head, ...body] = raw.split(/\r?\n\r?\n/);
      const qp = /content-transfer-encoding:\s*quoted-printable/i.test(head);
      const text = qp ? decodeQuotedPrintable(body.join("\n\n")) : body.join("\n\n");
      messages.push({ to: session.envelope.rcptTo.map((r) => r.address.toLowerCase()), text, at: Date.now() });
      callback();
    });
  },
});
smtp.listen(SMTP_PORT, "127.0.0.1");

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const to = url.searchParams.get("to")?.toLowerCase();
  const list = to ? messages.filter((m) => m.to.includes(to)) : messages;
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(list));
}).listen(HTTP_PORT, "127.0.0.1", () => console.log(`smtp sink ready on ${SMTP_PORT}/${HTTP_PORT}`));
