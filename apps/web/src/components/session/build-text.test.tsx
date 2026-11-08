import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { messagesFor } from "../../i18n/all-messages";
import { useBuildText } from "./execution";

function Probe() {
  const b = useBuildText();
  return (
    <p>
      {[
        b.kind("implement"),
        b.outcome("error"),
        b.text("The answer did not match the required structure"),
        b.text("Not executed: the install step could not run (no sandbox)."),
        b.text("Added the parser.\nRejected: ../etc/passwd"),
        b.testKind("repair-2:install"),
        b.check("success"),
        b.text("npm ERR! real output"),
      ].join("|")}
    </p>
  );
}

describe("build tab texts in the interface language (text audit 08.11.26)", () => {
  it("translates known values and sentences, keeps the rest", () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="de" messages={messagesFor("de")} timeZone="Europe/Zurich">
        <Probe />
      </NextIntlClientProvider>,
    );
    expect(html).toContain(
      "Umsetzung|Fehler|Die Antwort hatte nicht die geforderte Struktur|Nicht ausgeführt: Der Installationsschritt konnte nicht starten (keine Sandbox auf diesem Server).|Added the parser.\nAbgelehnte Dateien: ../etc/passwd|Reparatur 2 – Installation|bestanden|npm ERR! real output",
    );
  });
});

describe("build check proof from GitHub checks (night test R4)", () => {
  it("is verified only when every check passed, failed on any failure, pending otherwise", async () => {
    const { buildCheckProof } = await import("./execution");
    expect(buildCheckProof([{ status: "completed", conclusion: "success" }])).toBe("verified");
    expect(
      buildCheckProof([
        { status: "completed", conclusion: "success" },
        { status: "completed", conclusion: "failure" },
      ]),
    ).toBe("failed");
    expect(buildCheckProof([{ status: "in_progress", conclusion: null }])).toBe("pending");
    expect(buildCheckProof([])).toBe("pending");
  });
});
