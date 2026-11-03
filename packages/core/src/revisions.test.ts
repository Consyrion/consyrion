import { describe, expect, it } from "vitest";
import { architectureChange, objectionMoot, splitObjections } from "./revisions";

// Real run ses_3616f7c9… (#150): Proposal B replaced its architecture in the Consensus Round.
const v1 = {
  title: "Einfaches Go-basiertes Buchungssystem mit Redis-Locks",
  summary: "Go-Backend mit Redis für distributed Locks, Keycloak, React-PWA, Prometheus und Grafana auf einer einzelnen CX22.",
  architecture: "Go-Service, Redis-Locks und SELECT FOR UPDATE gegen Doppelbuchungen, eine CX22.",
};
const v2 = {
  title: "Django-PWA mit PostgreSQL-Exclusion-Constraint und automatisiertem Warm-Standby",
  summary: "Django mit PostgreSQL, Doppelbuchungen über einen Exclusion-Constraint, zwei Server mit Warm-Standby und Failover.",
  architecture: "Django-Monolith, PostgreSQL-Exclusion-Constraint, Primär- und Standby-Server, Caddy.",
};
const a = {
  label: "A",
  content: {
    title: "Django-Monolith mit PostgreSQL-Exclusion-Constraint",
    summary: "Django und PostgreSQL mit Warm-Standby auf zwei Servern.",
    architecture: "Django-Monolith, PostgreSQL-Exclusion-Constraint, Standby-Server.",
  },
};
const c = { label: "C", content: { title: "Rails-Anwendung", summary: "Rails mit MySQL.", architecture: "Rails, MySQL, ein Server." } };

describe("revisions (#150)", () => {
  it("recognises a replaced architecture and where it came from", () => {
    expect(architectureChange(v1, v2, [a, c])).toEqual({ changed: true, adoptedFrom: ["A"] });
    const corrected = { ...v1, summary: `${v1.summary} Zusätzlich Backups.` };
    expect(architectureChange(v1, corrected, [a, c])).toEqual({ changed: false, adoptedFrom: [] });
  });

  it("drops objections whose subject the current revision no longer contains", () => {
    expect(objectionMoot("Redis für distributed Locks + Go + Keycloak + React PWA + Prometheus/Grafana", v1, v2)).toBe(true);
    expect(objectionMoot("Doppelbuchungsschutz wird über Redis-Locks und SELECT FOR UPDATE umgesetzt statt über einen Datenbank-Constraint", v1, v2)).toBe(
      true,
    );
    expect(objectionMoot("Ein einzelner CX22 erfüllt das 15-Minuten-Ausfallziel nicht", v1, v2)).toBe(true);
    // Still true for the current revision: the PWA stays.
    expect(objectionMoot("Die PWA braucht ein Offline-Konzept", v1, v2)).toBe(false);
    // Nothing of the earlier version is named: no basis to drop it.
    expect(objectionMoot("Fehlende Datenschutz-Folgenabschätzung", v1, v2)).toBe(false);
  });
});

describe("objections against an earlier revision (#150)", () => {
  it("keeps objections against the current revision and moves those made moot by a later one", () => {
    const revisions = [
      { version: 1, content: v1, createdAt: "2026-10-27T10:00:00Z" },
      { version: 2, content: v2, createdAt: "2026-10-27T10:30:00Z" },
    ];
    const redis = { claim: "Redis für distributed Locks + Go + Keycloak", createdAt: "2026-10-27T10:10:00Z" };
    const pwa = { claim: "Die PWA braucht ein Offline-Konzept", createdAt: "2026-10-27T10:10:00Z" };
    const late = { claim: "Redis fehlt als Cache", createdAt: "2026-10-27T10:40:00Z" };
    const { current, moot } = splitObjections([redis, pwa, late], revisions);
    expect(moot).toEqual([{ ...redis, againstVersion: 1, currentVersion: 2 }]);
    expect(current).toEqual([pwa, late]);
  });
});
