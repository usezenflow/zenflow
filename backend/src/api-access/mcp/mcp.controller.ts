import {
  Controller,
  Delete,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, Response } from "express";
import type { User } from "../../../generated/prisma";
import { AllowOAuth, ApiTokenOnly } from "../allow-api-token.decorator";
import { ApiTokenGuard } from "../api-token.guard";
import { McpServerFactory } from "./mcp-server.factory";

/**
 * Streamable HTTP MCP at `/api/v1/mcp`, bearer token only. Stateless: each
 * POST gets its own server and transport. Server-to-client streams are not
 * offered, so GET and DELETE answer 405.
 */
@Controller("mcp")
@UseGuards(ApiTokenGuard)
@ApiTokenOnly()
@AllowOAuth()
export class McpController {
  constructor(private readonly servers: McpServerFactory) {}

  @Post()
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    const server = this.servers.create(req.user as User);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }

  @Get()
  getNotAllowed(@Res() res: Response): void {
    sendMethodNotAllowed(res);
  }

  @Delete()
  deleteNotAllowed(@Res() res: Response): void {
    sendMethodNotAllowed(res);
  }
}

function sendMethodNotAllowed(res: Response): void {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  });
}
