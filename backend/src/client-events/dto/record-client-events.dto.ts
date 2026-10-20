import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import type {
  ClientEventInput,
  ClientEventKindName,
  OfferChannel,
  RecordClientEventsRequest,
} from "@zenflow/shared";

export class ClientEventDto implements ClientEventInput {
  @IsIn(["OFFER_SHOWN", "APP_OPEN"])
  kind: ClientEventKindName;

  @IsOptional()
  @IsIn(["PUSH", "INBOX", "TOAST"])
  channel: OfferChannel | null = null;

  @IsOptional()
  @IsString()
  slotProposalId: string | null = null;

  @IsOptional()
  @IsString()
  sessionId: string | null = null;
}

export class RecordClientEventsDto implements RecordClientEventsRequest {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ClientEventDto)
  events: ClientEventDto[];
}
