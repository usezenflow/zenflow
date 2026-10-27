import { registerDecorator, ValidationArguments, ValidationOptions } from "class-validator";
import { MAX_TASK_MINUTES } from "@zenflow/shared";

/** Caps `durationMinutes` at `MAX_TASK_MINUTES` for a `TASK` only; fixed types keep their own limits. */
export function MaxTaskMinutes(validationOptions?: ValidationOptions) {
  return function (object: Record<string, any>, propertyName: string) {
    registerDecorator({
      name: "maxTaskMinutes",
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const { type } = args.object as { type?: string };
          return type !== "TASK" || typeof value !== "number" || value <= MAX_TASK_MINUTES;
        },
        defaultMessage: () => `durationMinutes must be at most ${MAX_TASK_MINUTES} for a task`,
      },
    });
  };
}
