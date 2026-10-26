import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { decideConsent, getConsent } from "@/api/oauth";
import { ErrorMark } from "@/components/brand/state-marks";
import { SunriseBackdrop } from "@/components/brand/sunrise-backdrop";
import { WithAuth } from "@/components/hoc/with-auth";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { DelayedSpinner } from "@/components/ui/delayed-spinner";
import { useNoindex } from "@/hooks/use-noindex";
import { t, useLanguage } from "@/lib/i18n";
import { apiErrorMessage } from "@/lib/toast";

type Phase = "loading" | "ask" | "sending" | "failed";

/** Where an AI assistant lands after the user signs in: allow it or refuse. */
function Consent() {
  useLanguage();
  const [params] = useSearchParams();
  const request = params.get("request") ?? "";
  const [phase, setPhase] = useState<Phase>("loading");
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [problem, setProblem] = useState("");

  useEffect(() => {
    let active = true;
    getConsent(request)
      .then((info) => {
        if (!active) return;
        setName(info.clientName);
        setHost(info.redirectHost);
        setPhase("ask");
      })
      .catch((error) => {
        if (!active) return;
        setProblem(apiErrorMessage(error, t("This request expired. Start again from your assistant.")));
        setPhase("failed");
      });
    return () => {
      active = false;
    };
  }, [request]);

  async function decide(approve: boolean) {
    setPhase("sending");
    try {
      const { redirectUrl } = await decideConsent(request, approve);
      window.location.assign(redirectUrl);
    } catch (error) {
      setProblem(apiErrorMessage(error, t("This request expired. Start again from your assistant.")));
      setPhase("failed");
    }
  }

  return (
    <div className="relative flex min-h-svh items-center justify-center overflow-hidden bg-background p-6">
      <SunriseBackdrop />
      <main className="relative flex w-full max-w-sm flex-col items-center gap-5 rounded-3xl border border-border bg-card/90 p-8 text-center shadow-xl backdrop-blur">
        {phase === "failed" ? (
          <>
            <ErrorMark />
            <p className="text-[15px] text-muted-foreground">{problem}</p>
          </>
        ) : phase === "loading" || phase === "sending" ? (
          <DelayedSpinner busy className="size-5 text-primary" />
        ) : (
          <>
            <Logo className="size-14" />
            <div className="flex flex-col gap-1.5">
              <h1 className="text-xl font-semibold">{t("Allow {name}?", { name })}</h1>
              <p className="text-[14px] leading-snug text-muted-foreground">
                {t("It can read your calendar and add or change your tasks.")}
              </p>
              <p className="text-[13px] text-muted-foreground">{t("You will be sent back to {host}.", { host })}</p>
            </div>
            <div className="flex w-full flex-col gap-2">
              <Button onClick={() => void decide(true)} className="rounded-full">
                {t("Allow")}
              </Button>
              <Button variant="ghost" onClick={() => void decide(false)} className="rounded-full">
                {t("Cancel")}
              </Button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default function OAuthConsentPage() {
  useNoindex();
  return (
    <WithAuth>
      <Consent />
    </WithAuth>
  );
}
