import { describe, expect, it } from "vitest";
import { themeScript } from "./theme-script";

function run(initial: Record<string, string>) {
  const data = new Map(Object.entries(initial));
  const storage = new Proxy(
    {
      getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    },
    { ownKeys: () => [...data.keys()], getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }) },
  );
  const document = { documentElement: { dataset: {} as Record<string, string> } };
  new Function("localStorage", "document", themeScript)(storage, document);
  return { data: Object.fromEntries(data), theme: document.documentElement.dataset.theme };
}

describe("root layout script", () => {
  it("moves every storage key from before the rename and keeps a value already stored under the new name", () => {
    const { data, theme } = run({
      "consyrion-theme": "light",
      "consyrion-assistant-open": "1",
      "consyrion-assistant-tab": "chat",
      "consyrion-assistant-chat-mode": "council",
      "consyrion.skillBlocks.dismissed:prj_1:skl_1@abc": "1",
      "consyrion-project-draft": "old",
      "consyrium-project-draft": "new",
      other: "x",
    });
    expect(Object.keys(data).filter((k) => k.startsWith("consyrion"))).toEqual([]);
    expect(data).toMatchObject({
      "consyrium-theme": "light",
      "consyrium-assistant-chat-mode": "council",
      "consyrium.skillBlocks.dismissed:prj_1:skl_1@abc": "1",
      "consyrium-project-draft": "new",
      other: "x",
    });
    expect(theme).toBe("light");
  });

  it("leaves the theme to the OS when nothing is stored", () => {
    expect(run({}).theme).toBeUndefined();
  });
});
