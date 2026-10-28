import { Controller, Get, Query, Req, Res } from "@nestjs/common";
import { RateLimit } from "@limitkit/nest";
import { randomBytes } from "crypto";
import type { Request, Response } from "express";
import { connectPage, expiredPage, type PageLang } from "./connect-page";
import { OAuthConsentService } from "./oauth-consent.service";
import { connectPageRules, connectPollRules } from "./oauth-rate-limit";

/**
 * Where an assistant's browser lands. It shows a code and waits; the signed-in
 * app approves with that code, so the browser never needs a login.
 */
@Controller("oauth/connect")
export class OAuthConnectController {
  constructor(private readonly consent: OAuthConsentService) {}

  @RateLimit({ rules: connectPageRules })
  @Get()
  async page(
    @Query("request") request = "",
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const lang: PageLang = req.acceptsLanguages("vi") ? "vi" : "en";
    const waiting = await this.consent.waiting(request);
    const nonce = randomBytes(16).toString("base64");
    res
      .status(waiting ? 200 : 400)
      .set({
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
      })
      .send(
        waiting ? connectPage({ ...waiting, lang, nonce }) : expiredPage(lang),
      );
  }

  @RateLimit({ rules: connectPollRules })
  @Get("status")
  async status(@Query("request") request = "", @Res() res: Response) {
    res
      .set("Cache-Control", "no-store")
      .json({ success: true, data: await this.consent.poll(request) });
  }
}
