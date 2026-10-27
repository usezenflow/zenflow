import { describe, expect, it } from "vitest";
import { clashOf } from "../palette/clash";
import { addLines } from "../palette/command";
import {
  deadlineOf,
  notBeforeOf,
  repeatOf,
  understand,
} from "../palette/understand";

const now = new Date(2026, 9, 27, 10); // Tue 27/10
const u = (s: string) => understand(s, now);

describe("understand", () => {
  it("reads lengths anywhere", () => {
    expect(u("math 2h").minutes).toBe(120);
    expect(u("2h math").minutes).toBe(120);
    expect(u("math 1h30").minutes).toBe(90);
    expect(u("math 45 min").minutes).toBe(45);
    expect(u("toán 2 giờ").minutes).toBe(120);
    expect(u("math 90m").title).toBe("math");
  });
  it("reads days with their joiner, in any order", () => {
    const r = u("toán trước thứ 6 2h");
    expect(u("math by fri").title).toBe("math");
    expect(u("math by fri").day?.getDate()).toBe(30);
    expect(u("tomorrow math").day?.getDate()).toBe(28);
    expect(u("math ngày mai").day?.getDate()).toBe(28);
    expect(u("math 3/11").day?.getMonth()).toBe(10);
    expect(r.minutes).toBe(120);
  });
  it("tells a clock from a length", () => {
    expect(u("math 7pm").time).toBe(19 * 60);
    expect(u("math 19:30").time).toBe(19 * 60 + 30);
    expect(u("math at 7h").time).toBe(7 * 60);
    expect(u("math 14h").time).toBe(14 * 60);
    expect(u("math 2h").time).toBeUndefined();
  });
  it("reads parts of the day", () => {
    expect(u("math sáng").window).toBe("MORNING");
    expect(u("math evening").window).toBe("EVENING");
  });
  it("leaves a plain title and a title that is all keywords alone", () => {
    expect(u("math homework")).toMatchObject({
      title: "math homework",
      spans: [],
    });
    expect(u("tomorrow")).toMatchObject({ title: "tomorrow", spans: [] });
    expect(u("math 2").minutes).toBeUndefined();
    expect(u("math 0m").minutes).toBeUndefined();
  });
  it("takes the first of each kind and reports spans", () => {
    const r = u("math 2h 3h");
    expect(r.minutes).toBe(120);
    expect(r.title).toBe("math 3h");
    expect(r.spans).toEqual([{ start: 5, end: 7, kind: "length", word: "2h" }]);
  });
  it("builds a deadline", () => {
    expect(deadlineOf(u("math fri"), now)?.getHours()).toBe(23);
    expect(deadlineOf(u("math fri 5pm"), now)?.getHours()).toBe(17);
    expect(deadlineOf(u("math 9am"), now)?.getDate()).toBe(28);
    expect(deadlineOf(u("math"), now)).toBeUndefined();
  });
  it("reads slang and dictation", () => {
    expect(u("bai tap trc t6").title).toBe("bai tap");
    expect(u("bai tap trc t6").day?.getDate()).toBe(30);
    const a = u("hop thu 2 7 gio toi");
    expect(a.title).toBe("hop");
    expect(a.day?.getDate()).toBe(2);
    expect(a.time).toBe(19 * 60);
    expect(u("doc sach 2 tieng ruoi tmr")).toMatchObject({
      title: "doc sach",
      minutes: 150,
    });
    expect(u("nop bao cao dl cuoi tuan")).toMatchObject({
      title: "nop bao cao",
    });
    expect(u("nop bao cao dl cuoi tuan").day?.getDate()).toBe(31);
    expect(u("on tap ba muoi phut mai")).toMatchObject({
      title: "on tap",
      minutes: 30,
    });
    expect(u("study 7 p.m. fri").time).toBe(19 * 60);
    expect(u("hop 7 gio 30").time).toBe(7 * 60 + 30);
    expect(u("hop 7 gio ruoi").time).toBe(7 * 60 + 30);
    expect(u("hop 7h toi").time).toBe(19 * 60);
    expect(u("hop thu hai").day?.getDate()).toBe(2);
    expect(u("math tomorow").day?.getDate()).toBe(28);
    expect(u("math 2 gio").minutes).toBe(120);
  });
  it("reads northern and southern Vietnamese", () => {
    expect(u("hop 7 gio kem 15 toi").time).toBe(18 * 60 + 45);
    expect(u("hop chua nhut").day?.getDate()).toBe(1);
    expect(u("nop bai tuan toi").day?.getDate()).toBe(3);
    expect(u("hoc bua nay")).toMatchObject({ title: "hoc" });
    expect(u("hoc bua nay").day?.getDate()).toBe(27);
    expect(u("hop ngay mot").day?.getDate()).toBe(29);
    expect(u("hop 7g30").time).toBe(7 * 60 + 30);
    expect(u("on tap 45ph").minutes).toBe(45);
    expect(u("on tap hai muoi lam phut").minutes).toBe(25);
    expect(u("on tap hai chuc phut").minutes).toBe(20);
    expect(u("on tap muoi lam phut").minutes).toBe(15);
    expect(u("on tap ba muoi mot phut").minutes).toBe(31);
    expect(u("an 12 gio trua").time).toBe(12 * 60);
    expect(u("an 1 gio trua").time).toBe(13 * 60);
    expect(u("hop 10 gio dem").time).toBe(22 * 60);
    expect(u("doc tieng ruoi").minutes).toBe(90);
  });
  it("reads an earliest start", () => {
    const a = u("lam bai tap after fri 3pm");
    expect(a.title).toBe("lam bai tap");
    expect(a.from?.day?.getDate()).toBe(30);
    expect(a.from?.time).toBe(15 * 60);
    expect(a.day).toBeUndefined();
    const b = u("on tap no sooner than 3pm by sun");
    expect(b.from?.time).toBe(15 * 60);
    expect(b.day?.getDate()).toBe(1);
    expect(b.title).toBe("on tap");
    expect(u("on tap sau t4 truoc t6")).toMatchObject({ title: "on tap" });
    expect(u("on tap sau t4 truoc t6").from?.day?.getDate()).toBe(28);
    expect(u("on tap sau t4 truoc t6").day?.getDate()).toBe(30);
    expect(u("hoc tu 3h chieu").from?.time).toBe(15 * 60);
    expect(notBeforeOf(u("hoc after fri"), now)?.getDate()).toBe(30);
  });
  it("reads a place", () => {
    expect(u("study at library tomorrow")).toMatchObject({
      title: "study",
      place: "library",
    });
    expect(u("hop tai quan cafe 3h chieu mai")).toMatchObject({
      title: "hop",
      place: "quan cafe",
    });
    expect(u("hop ở thư viện trước t6")).toMatchObject({
      title: "hop",
      place: "thư viện",
    });
    expect(u("hop at 7pm").place).toBeUndefined();
    expect(u("mua thu vien").day).toBeUndefined();
  });
  it("keeps sau and m apart, and reads a weekday of next week", () => {
    const r = u("voc deepcore trc t2 tuan sau m");
    expect(r.minutes).toBeUndefined();
    expect(r.day?.getDate()).toBe(2);
    expect(u("hop t4 tuan sau").day?.getDate()).toBe(4);
    expect(u("hop tuan sau t4").day?.getDate()).toBe(4);
    expect(u("hop next fri").day?.getDate()).toBe(6);
    expect(u("on tap sáu giờ").minutes).toBe(360);
    expect(u("on tap sau gio").minutes).toBeUndefined();
  });
  it("reads a month", () => {
    const b = u("build probe trc thang 12");
    expect(b.title).toBe("build probe");
    expect([b.day?.getMonth(), b.day?.getDate()]).toEqual([10, 30]);
    const c = u("build probe trong thang 12");
    expect([c.day?.getMonth(), c.day?.getDate()]).toEqual([11, 31]);
    const d = u("nop ngay 5 thang 12");
    expect([d.title, d.day?.getMonth(), d.day?.getDate()]).toEqual([
      "nop",
      11,
      5,
    ]);
  });
  it("reads repeats", () => {
    expect(u("doc sach moi ngay").repeat).toEqual({ freq: "DAILY" });
    expect(u("doc sach moi ngay").title).toBe("doc sach");
    expect(u("gym every mon 6pm").repeat).toEqual({
      freq: "WEEKLY",
      days: [1],
    });
    expect(u("gym 6pm hang tuan").repeat).toEqual({ freq: "WEEKLY" });
    expect(u("gym t2 hang tuan").repeat).toEqual({ freq: "WEEKLY", days: [1] });
    expect(u("hoc moi tuan").repeat?.freq).toBe("WEEKLY");
    expect(u("mua moi ban")).toMatchObject({ title: "mua moi ban", spans: [] });
    expect(u("mua đồ mới ngày mai").repeat).toBeUndefined();
  });
  it("turns a repeat into a fixed series or one task per day", () => {
    const fixed = repeatOf(u("gym every mon 6pm"), now)!;
    expect(fixed.rrule).toBe("FREQ=WEEKLY;BYDAY=MO");
    expect([
      fixed.start?.getMonth(),
      fixed.start?.getDate(),
      fixed.start?.getHours(),
    ]).toEqual([10, 2, 18]);
    const daily = repeatOf(u("doc sach moi ngay"), now)!;
    expect(daily.start).toBeUndefined();
    expect(daily.deadlines).toHaveLength(7);
    expect(daily.deadlines[0].getDate()).toBe(27);
    expect(repeatOf(u("doc sach hang tuan t4"), now)!.deadlines).toHaveLength(
      4,
    );
  });
  it("reads a split", () => {
    expect(u("project 6h in 2 blocks")).toMatchObject({
      title: "project",
      minutes: 360,
      split: 2,
    });
    expect(u("project 6h chia 3 buoi")).toMatchObject({
      title: "project",
      split: 3,
    });
    expect(u("project 6h split 2").split).toBe(2);
    expect(u("project 2h 3 parts").split).toBe(3);
    expect(u("project 6h in 9 blocks").split).toBe(3);
    expect(u("doc 2 buoi hoc").split).toBeUndefined();
  });
  it("leaves a skipped word in the title", () => {
    expect(u("mua thu")).toMatchObject({
      title: "mua",
      spans: [{ word: "thu" }],
    });
    expect(understand("mua thu", now, new Set(["thu"]))).toMatchObject({
      title: "mua thu",
      spans: [],
    });
  });
  it("leaves plain titles alone", () => {
    for (const t of ["an trua", "mua sach", "hoc tieng anh", "doc sach mot so"])
      expect(u(t)).toMatchObject({ title: t, spans: [] });
  });
});

describe("repeat bounds and clashes", () => {
  it("reads a weekday list, a start and an end", () => {
    const x = understand("gym every mon, tue 6pm after 2/11 by 30/11", now);
    expect(x.repeat?.days).toEqual([1, 2]);
    const rep = repeatOf(x, now)!;
    expect(rep.rrule).toMatch(/^FREQ=WEEKLY;BYDAY=MO,TU;UNTIL=20261130T/);
    expect(rep.start?.getDate()).toBe(2);
  });
  it("keeps a weekday list on one line", () => {
    expect(addLines("gym every mon, tue 6pm, buy milk")).toEqual([
      "gym every mon tue 6pm",
      "buy milk",
    ]);
    expect(addLines("moi T2, T3 hoc")).toEqual(["moi T2 T3 hoc"]);
  });
  it("reads tai and o as at", () => {
    expect(understand("hop tai 7h", now).time).toBe(7 * 60);
    expect(understand("hop o 7h", now).time).toBe(7 * 60);
  });
  it("flags what cannot hold", () => {
    expect(clashOf(understand("report by 30/3", now), now)).toBe("far");
    expect(clashOf(understand("report 6h in 2 blocks every mon", now), now)).toBe("repeatSplit");
    expect(clashOf(understand("gym every mon 6pm by 28/10", now), now)).toBe("endBeforeStart");
    expect(clashOf(understand("report by 30/11", now), now)).toBeNull();
  });
});

describe("dictation", () => {
  it("ends a task at a period but keeps 7 p.m. and 1.5h whole", () => {
    expect(addLines("Math 2h. Physics 1.5h")).toEqual(["Math 2h", "Physics 1.5h"]);
    expect(addLines("Gym 7 p.m. Friday")).toEqual(["Gym 7 p.m. Friday"]);
  });
});
