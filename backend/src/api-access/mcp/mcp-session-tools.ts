import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BadRequestException, HttpException } from "@nestjs/common";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { z } from "zod";
import type { User } from "../../../generated/prisma";
import { BulkCreateSessionsDto } from "../../sessions/dto/bulk-create-sessions.dto";
import { BulkDeleteSessionsDto } from "../../sessions/dto/bulk-delete-sessions.dto";
import {
  ListSessionsDto,
  SESSION_SORTS,
  SESSION_TYPES,
} from "../../sessions/dto/list-sessions.dto";
import { UpdateSessionDto } from "../../sessions/dto/update-session.dto";
import { SessionsService } from "../../sessions/sessions.service";
import { PlacementPlanService } from "../../sessions/placement-plan.service";
import { GoogleCalendarService } from "../../google-calendar/google-calendar.service";
import { MAX_BULK_SESSIONS } from "@zenflow/shared";
import { MAX_ATTENDEES } from "../../common/constants";
import { MCP_TOOLS } from "./mcp-tool-catalog";

const text = (value: unknown, isError = false): CallToolResult => ({
  content: [
    {
      type: "text",
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    },
  ],
  isError,
});

/** Invitations go out through Google only. Refuse rather than save a session that invites nobody. */
function requireGoogleForInvites(user: User, attendees: unknown): void {
  if (
    Array.isArray(attendees) &&
    attendees.length > 0 &&
    user.calendarTarget !== "GOOGLE"
  )
    throw new BadRequestException(
      "Invitations need Google Calendar as the calendar target. Connect Google in settings, or remove the attendees.",
    );
}

/** Runs a tool body; a thrown error becomes a tool error the assistant can read. */
async function run(body: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return text(await body());
  } catch (err) {
    return text(errorMessage(err), true);
  }
}

/** The message the REST route would send, so the assistant can relay it. */
function errorMessage(err: unknown): string {
  if (err instanceof HttpException) {
    const body = err.getResponse();
    if (typeof body === "object" && body !== null) {
      const { message, code } = body as { message?: unknown; code?: unknown };
      const detail = Array.isArray(message) ? message.join(" ") : message;
      if (typeof detail === "string") {
        return typeof code === "string" ? `${code}: ${detail}` : detail;
      }
    }
  }
  return err instanceof Error ? err.message : "Request failed.";
}

/** Validates tool input with the same DTO rules as the REST body. */
async function validated<T extends object>(
  cls: new () => T,
  plain: Record<string, unknown>,
): Promise<T> {
  const dto = plainToInstance(cls, plain);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  if (errors.length > 0) {
    throw new Error(
      errors.flatMap((e) => Object.values(e.constraints ?? {})).join(" "),
    );
  }
  return dto;
}

/** The services the session tools call; each is the one the REST route uses. */
export interface SessionToolServices {
  sessions: SessionsService;
  placement: PlacementPlanService;
  calendar: GoogleCalendarService;
}

/**
 * Registers the session tools on one request's server. Each handler calls the
 * same service as the REST route, so validation and writes are shared.
 */
export function registerSessionTools(
  server: McpServer,
  { sessions, placement, calendar }: SessionToolServices,
  user: User,
): void {
  const described = (name: string) => {
    const tool = MCP_TOOLS.find((t) => t.name === name);
    if (!tool) throw new Error(`Unknown MCP tool ${name}`);
    return tool.description;
  };

  server.registerTool(
    "list_schedule",
    {
      description: described("list_schedule"),
      inputSchema: {
        from: z.iso.date(),
        to: z.iso.date(),
        q: z.string().max(200).optional(),
        types: z.array(z.enum(SESSION_TYPES)).optional(),
        minDuration: z.number().int().min(15).max(1440).optional(),
        maxDuration: z.number().int().min(15).max(1440).optional(),
        deadlineFrom: z.iso.date().optional(),
        deadlineTo: z.iso.date().optional(),
        sort: z.enum(SESSION_SORTS).optional(),
        order: z.enum(["asc", "desc"]).optional(),
      },
    },
    (args) =>
      run(async () => {
        const dto = plainToInstance(ListSessionsDto, args);
        return sessions.list(dto, user);
      }),
  );

  server.registerTool(
    "get_session",
    {
      description: described("get_session"),
      inputSchema: { id: z.string().min(1).max(200) },
    },
    (args) => run(() => sessions.findById(args.id, user)),
  );

  server.registerTool(
    "update_session",
    {
      description: described("update_session"),
      inputSchema: {
        id: z.string().min(1).max(200),
        title: z.string().max(60).optional(),
        location: z.string().max(200).nullable().optional(),
        durationMinutes: z.number().int().positive().optional(),
        reminderMinutes: z.number().int().nullable().optional(),
        attendees: z.array(z.string().max(320)).max(MAX_ATTENDEES).optional(),
        deadline: z.string().optional(),
        scheduledStartTime: z.string().optional(),
        scope: z.enum(["occurrence", "following", "series"]).optional(),
      },
    },
    ({ id, ...changes }) =>
      run(async () => {
        requireGoogleForInvites(user, changes.attendees);
        return sessions.update(
          id,
          await validated(UpdateSessionDto, changes),
          user,
        );
      }),
  );

  server.registerTool(
    "delete_sessions",
    {
      description: described("delete_sessions"),
      inputSchema: {
        dryRun: z.boolean().optional(),
        items: z
          .array(
            z.object({
              kind: z.enum(["session", "series", "timetable"]),
              id: z.string().min(1).max(200),
              scope: z.enum(["all", "following"]).optional(),
            }),
          )
          .min(1)
          .max(MAX_BULK_SESSIONS),
      },
    },
    (args) =>
      run(async () =>
        sessions.bulkDelete(await validated(BulkDeleteSessionsDto, args), user),
      ),
  );

  server.registerTool(
    "sync_status",
    { description: described("sync_status"), inputSchema: {} },
    () => run(() => calendar.status(user)),
  );

  server.registerTool(
    "undo_last_change",
    { description: described("undo_last_change"), inputSchema: {} },
    () => run(() => placement.undoLatest(user)),
  );

  server.registerTool(
    "create_tasks",
    {
      description: described("create_tasks"),
      inputSchema: {
        dryRun: z.boolean().optional(),
        items: z
          .array(z.record(z.string(), z.unknown()))
          .min(1)
          .max(MAX_BULK_SESSIONS),
      },
    },
    (args) =>
      run(async () => {
        args.items.forEach((item) =>
          requireGoogleForInvites(user, item.attendees),
        );
        return sessions.bulkCreate(
          await validated(BulkCreateSessionsDto, args),
          user,
        );
      }),
  );
}
