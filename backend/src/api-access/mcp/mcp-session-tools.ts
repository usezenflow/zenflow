import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { z } from "zod";
import type { User } from "../../../generated/prisma";
import { BulkCreateSessionsDto } from "../../sessions/dto/bulk-create-sessions.dto";
import { ListSessionsDto } from "../../sessions/dto/list-sessions.dto";
import { SessionsService } from "../../sessions/sessions.service";
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

/** Runs a tool body; a thrown error becomes a tool error the assistant can read. */
async function run(body: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return text(await body());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Request failed.";
    return text(message, true);
  }
}

/**
 * Registers the session tools on one request's server. Each handler calls the
 * same service as the REST route, so validation and writes are shared.
 */
export function registerSessionTools(
  server: McpServer,
  sessions: SessionsService,
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
        view: z.enum(["day", "week", "month"]),
        date: z.iso.date(),
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
    "create_tasks",
    {
      description: described("create_tasks"),
      inputSchema: {
        dryRun: z.boolean().optional(),
        items: z.array(z.record(z.string(), z.unknown())).min(1).max(20),
      },
    },
    (args) =>
      run(async () => {
        const dto = plainToInstance(BulkCreateSessionsDto, args);
        const errors = await validate(dto, {
          whitelist: true,
          forbidNonWhitelisted: true,
        });
        if (errors.length > 0) {
          throw new Error(
            errors.flatMap((e) => Object.values(e.constraints ?? {})).join(" "),
          );
        }
        return sessions.bulkCreate(dto, user);
      }),
  );
}
