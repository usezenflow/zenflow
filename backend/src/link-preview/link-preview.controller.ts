import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { CookieAuthGuard } from "../auth/guards";
import { LinkPreviewService } from "./link-preview.service";
import { LinkPreviewQueryDto } from "./dto/link-preview-query.dto";

@Controller("link-preview")
@UseGuards(CookieAuthGuard)
export class LinkPreviewController {
  constructor(private readonly linkPreview: LinkPreviewService) {}

  @Get()
  async get(@Query() query: LinkPreviewQueryDto) {
    const data = await this.linkPreview.preview(query.url);
    return {
      success: true,
      message: data ? "Found link preview" : "No link preview",
      data,
    };
  }
}
