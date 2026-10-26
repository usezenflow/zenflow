import { IsIn } from "class-validator";
import type { SetCalendarTargetInput } from "@zenflow/shared";

export class SetCalendarTargetDto implements SetCalendarTargetInput {
  @IsIn(["NONE", "DEVICE"])
  target!: "NONE" | "DEVICE";
}
