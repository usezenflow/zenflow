import { validate } from "class-validator";
import { MaxTaskMinutes } from "./max-task-minutes.decorator";

class Dto {
  type!: string;
  @MaxTaskMinutes() durationMinutes!: number;
}
const make = (type: string, durationMinutes: number) =>
  Object.assign(new Dto(), { type, durationMinutes });

describe("MaxTaskMinutes", () => {
  it.each([
    ["TASK", 240, 0],
    ["TASK", 255, 1],
    ["EXAM", 480, 0],
  ])("%s %i minutes gives %i errors", async (type, minutes, errors) => {
    expect(await validate(make(type, minutes))).toHaveLength(errors);
  });
});
