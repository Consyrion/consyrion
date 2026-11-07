import { describe, expect, it } from "vitest";
import de from "../../messages/de.json";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import fr from "../../messages/fr.json";
import zh from "../../messages/zh.json";
import { STORY_CHAPTERS } from "../components/landing/story-chapters";
import { MESSAGE_FILES, messagesFor } from "./all-messages";
import { LOCALES, localeFromAcceptLanguage, MESSAGE_AREAS } from "./locales";

// Lists of strings are leaves (same length required); lists of objects (3D scene labels) are compared item by item.
type Tree = { [key: string]: Tree | string | string[] | Tree[] };
const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
const flat = (tree: Tree, prefix = ""): Record<string, string | string[]> =>
  Object.fromEntries(
    Object.entries(tree).flatMap(([k, v]) =>
      typeof v === "string" || isStringList(v)
        ? [[`${prefix}${k}`, v]]
        : Array.isArray(v)
          ? (v as Tree[]).flatMap((item, i) => Object.entries(flat(item, `${prefix}${k}.${i}.`)))
          : Object.entries(flat(v as Tree, `${prefix}${k}.`)),
    ),
  );
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("interface translations (owner decision 05.11.26: en, de, fr, es, zh)", () => {
  // Every file (main + areas) merged per locale, so area translations are checked the same way.
  const base = flat(messagesFor("en") as unknown as Tree);
  const all = { de: messagesFor("de"), fr: messagesFor("fr"), es: messagesFor("es"), zh: messagesFor("zh") } as unknown as Record<string, Tree>;
  void de;
  void fr;
  void es;
  void zh;

  it("covers every locale and every English key, with the same placeholders and list lengths", () => {
    expect([...LOCALES].sort()).toEqual(["de", "en", "es", "fr", "zh"]);
    for (const [locale, messages] of Object.entries(all)) {
      const other = flat(messages);
      expect(Object.keys(other).sort(), locale).toEqual(Object.keys(base).sort());
      for (const [key, value] of Object.entries(base)) {
        const translated = other[key]!;
        if (Array.isArray(value)) expect((translated as string[]).length, `${locale} ${key}`).toBe(value.length);
        else expect(placeholders(translated as string), `${locale} ${key}`).toEqual(placeholders(value));
      }
    }
  });

  it("keeps area namespaces apart: no top-level key in two files", () => {
    const f = MESSAGE_FILES.en;
    const owners = new Map<string, string>();
    for (const [file, messages] of [["main", f.main], ...MESSAGE_AREAS.map((a) => [a, f.areas[a]] as const)] as const) {
      for (const key of Object.keys(messages)) {
        expect(owners.get(key), `${key} in ${file} and ${owners.get(key)}`).toBeUndefined();
        owners.set(key, file);
      }
    }
  });

  it("has words for every story chapter, but keeps the canonical phase names out of the files", () => {
    for (const chapter of STORY_CHAPTERS) {
      expect(base[`story.chapters.${chapter.id}.text`], chapter.id).toBeTruthy();
      expect(base[`story.chapters.${chapter.id}.title`] === undefined, chapter.id).toBe(Boolean(chapter.phase));
    }
  });

  it("keeps the 3D scene labels in step with the scene's English defaults", async () => {
    const { SCENE_LABELS_EN } = await import("../components/landing/story-scene");
    expect(en.scene).toEqual(SCENE_LABELS_EN);
  });

  it("picks the best supported browser language", () => {
    expect(localeFromAcceptLanguage("de-CH,de;q=0.9,en;q=0.8")).toBe("de");
    expect(localeFromAcceptLanguage("pt-BR,pt;q=0.9,es;q=0.5")).toBe("es");
    expect(localeFromAcceptLanguage("zh-CN")).toBe("zh");
    expect(localeFromAcceptLanguage("ja")).toBe("en");
    expect(localeFromAcceptLanguage(null)).toBe("en");
  });
});
