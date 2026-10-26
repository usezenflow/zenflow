import { IsIn } from "class-validator";
import type { SetCalendarTargetInput } from "@zenflow/shared";

/** Only the phone target is set here; Google is set by connecting. */
export class SetCalendarTargetDto implements SetCalendarTargetInput {
  @IsIn(["NONE", "DEVICE"])
  target!: "NONE" | "DEVICE";
}
