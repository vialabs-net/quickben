import { afterAll, describe, expect, it } from "vitest";

import {
  ConfigError,
  createQuickben,
  dateInTimeZone,
  defineCollection,
  defineConfig,
  fields as f,
  formatDateValue,
  isTimeZone,
  localDateTime,
  toDatetimeValue,
  toDateValue,
  ValidationError,
  zonedTimeToUtc,
} from "../src";

import { system, testAdapter } from "./helpers";

const originalTz = process.env.TZ;
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

/** Server time zones the results must not depend on. Node reads `TZ` on every change. */
const serverZones = ["UTC", "Pacific/Kiritimati", "America/Santiago", "Asia/Tokyo", "Etc/GMT+12"];

const events = defineCollection({
  slug: "events",
  fields: {
    day: f.date(),
    utcDay: f.date({ timeZone: "UTC" }),
    at: f.datetime(),
  },
  access: { read: () => true, create: () => true },
});

async function store(serverZone: string) {
  process.env.TZ = serverZone;
  const qb = await createQuickben(
    defineConfig({ db: testAdapter(), collections: [events], timeZone: "America/New_York" }),
  );
  const doc = await qb.create(
    "events",
    {
      day: new Date("2026-01-02T03:00:00Z"), // 22:00 on Jan 1 in New York
      utcDay: "2026-01-01T23:00:00-05:00", // Jan 2 in UTC
      at: "2026-07-01", // midnight in New York
    },
    system,
  );
  const found = await qb.find(
    "events",
    { where: { day: { eq: new Date("2026-01-02T03:00:00Z") }, at: { lt: "2026-07-01T00:01" } } },
    system,
  );
  return { doc, matches: found.totalDocs };
}

describe("date inputs resolve in the configured time zone (#25)", () => {
  it.each(serverZones)("give the same result when the server runs in %s", async (zone) => {
    const { doc, matches } = await store(zone);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone);
    expect(doc).toMatchObject({
      day: "2026-01-01",
      utcDay: "2026-01-02",
      at: "2026-07-01T04:00:00.000Z",
    });
    expect(matches).toBe(1);
  });

  it("keeps YYYY-MM-DD and rejects invalid dates", async () => {
    process.env.TZ = "Asia/Tokyo";
    const qb = await createQuickben(defineConfig({ db: testAdapter(), collections: [events] }));
    expect(await qb.create("events", { day: "2026-03-01" }, system)).toMatchObject({
      day: "2026-03-01",
    });
    await expect(qb.create("events", { day: "2026-02-30" }, system)).rejects.toThrow(
      ValidationError,
    );
    await expect(
      qb.find("events", { where: { day: { eq: "March 1, 2026" } } }, system),
    ).rejects.toThrow("Expected a date");
  });

  it("rejects unknown time zones in the config and in fields", () => {
    expect(() =>
      defineConfig({ db: testAdapter(), collections: [], timeZone: "Mars/Olympus" }),
    ).toThrow(ConfigError);
    expect(() =>
      defineCollection({ slug: "bad", fields: { day: f.date({ timeZone: "Nowhere" }) } }),
    ).toThrow('unknown time zone "Nowhere"');
    expect(defineConfig({ db: testAdapter(), collections: [] }).timeZone).toBe("UTC");
  });
});

describe("time helpers", () => {
  it("convert between instants and wall-clock times", () => {
    expect(isTimeZone("Europe/Madrid")).toBe(true);
    expect(isTimeZone("")).toBe(false);
    expect(isTimeZone(3)).toBe(false);
    expect(dateInTimeZone("2026-01-01T23:00:00-05:00", "UTC")).toBe("2026-01-02");
    expect(localDateTime("2026-07-01T08:00:00Z", "Europe/Berlin")).toBe("2026-07-01T10:00");
    expect(localDateTime("nope", "UTC")).toBe("");
    expect(zonedTimeToUtc("2026-07-01T10:00", "Europe/Berlin")).toBe("2026-07-01T08:00:00.000Z");
    expect(zonedTimeToUtc("2026-07-01T10:00:30", "UTC")).toBe("2026-07-01T10:00:30.000Z");
    expect(zonedTimeToUtc("2026-02-30", "UTC")).toBeNull();
    expect(zonedTimeToUtc("2026-01-01T24:00", "UTC")).toBeNull();
    expect(zonedTimeToUtc("tomorrow", "UTC")).toBeNull();
  });

  it("handle daylight saving gaps and repeated hours", () => {
    // 02:30 does not exist on 2026-03-08 in New York; it moves forward to 03:30 EDT.
    expect(zonedTimeToUtc("2026-03-08T02:30", "America/New_York")).toBe("2026-03-08T07:30:00.000Z");
    // 01:30 happens twice on 2026-11-01; the earlier (EDT) instant wins.
    expect(zonedTimeToUtc("2026-11-01T01:30", "America/New_York")).toBe("2026-11-01T05:30:00.000Z");
  });

  it("resolve stored values", () => {
    expect(toDateValue("2026-05-05T10:00", "Asia/Tokyo")).toBe("2026-05-05");
    expect(toDateValue(new Date("2026-05-05T20:00:00Z"), "Asia/Tokyo")).toBe("2026-05-06");
    expect(toDateValue(new Date(Number.NaN), "UTC")).toBeNull();
    expect(toDateValue("2026-05-05T25:00:00Z", "UTC")).toBeNull();
    expect(toDatetimeValue("2026-05-05T10:00:00+02:00", "Asia/Tokyo")).toBe(
      "2026-05-05T08:00:00.000Z",
    );
    expect(toDatetimeValue("2026-05-05T10:00", "Asia/Tokyo")).toBe("2026-05-05T01:00:00.000Z");
  });

  it("format dates and datetimes in a locale and time zone", () => {
    process.env.TZ = "Pacific/Honolulu";
    expect(formatDateValue("2026-01-01", { locale: "en", timeZone: "Asia/Tokyo" })).toBe(
      "Jan 1, 2026",
    );
    expect(formatDateValue("2026-01-01T03:00:00Z", { locale: "en", timeZone: "UTC" })).toBe(
      "Jan 1, 2026, 3:00 AM",
    );
    expect(
      formatDateValue("2026-01-01T03:00:00Z", {
        locale: "es",
        timeZone: "America/Santiago",
        type: "date",
        dateStyle: "long",
      }),
    ).toBe("1 de enero de 2026");
    expect(formatDateValue(new Date("2026-01-01T03:00:00Z"), { type: "date" })).toBe("Jan 1, 2026");
    expect(formatDateValue("soon")).toBe("soon");
  });
});
