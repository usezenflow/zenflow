import { planWalkers, type WalkerCandidate } from "./walker-planner";

const students: WalkerCandidate[] = [
  { userId: "p1", sectionIds: ["A", "B", "C"] },
  { userId: "p2", sectionIds: ["A", "B"] },
  { userId: "p3", sectionIds: ["A", "B"] },
  { userId: "p4", sectionIds: ["D", "E"] },
  { userId: "p5", sectionIds: ["F"] },
];
const ALL = new Set(["A", "B", "C", "D", "E", "F"]);

describe("planWalkers", () => {
  it("takes the largest shared sections first, then the rarer ones", () => {
    // A and B are held by three students, C, D, E and F by one each.
    expect(planWalkers(students, ALL)).toEqual(["p1", "p4", "p5", "p2", "p3"]);
  });

  it("drops a walker whose sections are all warm to the back, in input order", () => {
    expect(planWalkers(students, new Set(["D", "E"]))).toEqual([
      "p4",
      "p1",
      "p2",
      "p3",
      "p5",
    ]);
  });

  it("keeps input order when nothing is stale", () => {
    expect(planWalkers(students, new Set())).toEqual([
      "p1",
      "p2",
      "p3",
      "p4",
      "p5",
    ]);
  });

  it("counts a section once per student", () => {
    const dup: WalkerCandidate[] = [
      { userId: "x", sectionIds: ["A", "A"] },
      { userId: "y", sectionIds: ["A"] },
    ];
    expect(planWalkers(dup, new Set(["A"]))).toEqual(["x", "y"]);
  });
});
