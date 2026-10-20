import { IsString, IsUrl, MaxLength } from "class-validator";

export class LinkPreviewQueryDto {
  @IsString()
  @MaxLength(2048)
  @IsUrl({
    protocols: ["http", "https"],
    require_protocol: true,
    require_tld: false,
  })
  url!: string;
}
