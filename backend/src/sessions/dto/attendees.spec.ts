import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { UpdateSessionDto } from "./update-session.dto";

const errorsFor = (attendees: unknown) =>
  validate(plainToInstance(UpdateSessionDto, { attendees }));

describe("session invitees", () => {
  it("lowercases and dedupes invitee emails", () => {
    const dto = plainToInstance(UpdateSessionDto, {
      attendees: [" Ann@Example.com ", "ann@example.com"],
    });
    expect(dto.attendees).toEqual(["ann@example.com"]);
  });

  it("rejects a malformed email and more than 20 invitees", async () => {
    expect(await errorsFor(["not an email"])).toHaveLength(1);
    const crowd = Array.from({ length: 21 }, (_, i) => `a${i}@example.com`);
    expect(await errorsFor(crowd)).toHaveLength(1);
  });

  it("accepts an empty list, which removes every invitee", async () => {
    expect(await errorsFor([])).toEqual([]);
  });
});
