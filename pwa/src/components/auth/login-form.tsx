import { requestOtp, verifyOtp } from "@/api/auth";
import { updateBasicInfo } from "@/api/users";
import { apiErrorMessage } from "@/lib/toast";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Glass } from "@/components/ui/glass";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { DelayedSpinner } from "@/components/ui/delayed-spinner";
import { useUserStore } from "@/hooks/use-user-store";
import type { User } from "@/types/user";
import { getLanguage, t, useLanguage } from "@/lib/i18n";
import { SITE_URL } from "@/lib/site";
import { cn } from "@/lib/utils";
import { hideEmail } from "@/utils/hide-email";
import { zodResolver } from "@hookform/resolvers/zod";
import { isAxiosError } from "axios";
import { ArrowLeft, Clock3 } from "lucide-react";
import { useState, type ComponentProps, type ReactNode } from "react";
import {
  type Resolver,
  type SubmitHandler,
  useForm,
} from "react-hook-form";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "@/lib/notify";
import { z } from "zod";
import {
  extractOtp,
  loginEmail,
  type LoginMode,
  parseLoginInput,
  STUDENT_EMAIL_DOMAIN,
  switchLoginMode,
} from "./login-id";
import { LanguageSelect } from "./language-select";
import { formatCountdown, useCountdown } from "./use-countdown";

/** Client-side throttle on "Resend code", shorter than the server's real limit. */
const RESEND_COOLDOWN_SECONDS = 30;
/** Fallback when a 429 has no usable `Retry-After`. */
const DEFAULT_RETRY_AFTER_SECONDS = 30;
const OTP_LENGTH = 6;

const emailSchema = z.object({
  email: z.email({ error: () => t("Invalid email address.") }),
});

const idSchema = z.object({
  email: z
    .string()
    .regex(/^\d+$/, { error: () => t("Enter your student ID.") }),
});

const otpSchema = z.object({
  otp: z
    .string()
    .length(OTP_LENGTH, {
      error: () => t("Your one-time password must be 6 digits."),
    }),
});

interface FormValues {
  email: string;
  otp: string;
}

function retryAfterSeconds(error: unknown): number {
  if (isAxiosError(error)) {
    const parsed = Number(error.response?.headers?.["retry-after"]);
    if (Number.isFinite(parsed) && parsed > 0) return Math.ceil(parsed);
  }
  return DEFAULT_RETRY_AFTER_SECONDS;
}

function LockoutNotice({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2 flex items-start gap-1.5 text-[13px] font-medium text-foreground">
      <Clock3 className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <span>{children}</span>
    </p>
  );
}

/** The sign-in card: student ID or email, then the six-digit code. Mirrors `mobile/app/(auth)/login.tsx`. */
export function LoginForm({
  className,
  ...props
}: ComponentProps<"div">) {
  useLanguage();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setUser = useUserStore((state) => state.setUser);

  const [stage, setStage] = useState<"email" | "otp">("email");
  const [loginMode, setLoginMode] = useState<LoginMode>("id");
  // The address the code went to; verify and resend use it.
  const [sentTo, setSentTo] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Rate-limit states: a 429 on request, the resend throttle, and a 429 on verify.
  const requestLockout = useCountdown();
  const resendCooldown = useCountdown();
  const otpLockout = useCountdown();

  const form = useForm<FormValues>({
    resolver: zodResolver(
      stage === "otp" ? otpSchema : loginMode === "id" ? idSchema : emailSchema,
    ) as unknown as Resolver<FormValues>,
    defaultValues: { email: "", otp: "" },
    mode: "onSubmit",
    reValidateMode: "onSubmit",
  });
  const { handleSubmit, setError, clearErrors } = form;

  async function handleEmailRequest(address: string) {
    if (requestLockout.active) return;
    setSubmitting(true);
    clearErrors();
    try {
      await requestOtp(address, getLanguage());
      toast.info(t("Check your inbox"), { icon: "bell" });
      requestLockout.clear();
      setSentTo(address);
      setStage("otp");
      form.setValue("otp", "");
      otpLockout.clear();
      resendCooldown.start(RESEND_COOLDOWN_SECONDS);
    } catch (error) {
      const field = stage === "otp" ? "otp" : "email";
      if (isAxiosError(error) && error.response?.status === 429) {
        requestLockout.start(retryAfterSeconds(error));
      } else {
        const message =
          isAxiosError(error) && error.response
            ? error.response.data?.code === "EMAIL_DOMAIN_NOT_ALLOWED"
              ? t(
                  "Zenflow is open to DLU students for now. Use your @dlu.edu.vn email.",
                )
              : apiErrorMessage(error, t("Couldn't send the code. Try again."))
            : t("No connection. Check your internet and try again.");
        setError(field, { type: "manual", message });
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleOtpVerify(otp: string) {
    if (otpLockout.active) return;
    setSubmitting(true);
    clearErrors("otp");
    try {
      const result = await verifyOtp(sentTo, otp);
      let user: User = result.data;
      if (user.onboardedAt) toast.success(t("Welcome back"), { icon: "sparkles" });
      // The language on this screen overrides the account's stored preference.
      const language = getLanguage();
      if (user.lang !== language) {
        try {
          user = await updateBasicInfo({ lang: language });
        } catch {
          // Offline blip: the account's own language applies instead.
        }
      }
      setUser(user);
      navigate(
        user.onboardedAt
          ? (searchParams.get("callback") ?? "/")
          : "/onboarding",
      );
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 429) {
        otpLockout.start(retryAfterSeconds(error));
      } else {
        const message =
          isAxiosError(error) && error.response
            ? apiErrorMessage(error, t("Couldn't verify the code. Try again."))
            : t("No connection. Check your internet and try again.");
        setError("otp", { type: "manual", message });
      }
    } finally {
      setSubmitting(false);
    }
  }

  const onSubmit: SubmitHandler<FormValues> = async (data) => {
    if (stage === "email") {
      await handleEmailRequest(loginEmail(data.email, loginMode));
    } else {
      await handleOtpVerify(data.otp);
    }
  };

  return (
    <div className={cn("relative flex flex-col gap-6", className)} {...props}>
      <div className="absolute top-0 right-0 z-10">
        <LanguageSelect />
      </div>

      <div className="flex flex-col items-center gap-3.5 pt-12 text-center">
        <Logo className="size-16" />
        <div className="flex flex-col items-center gap-1">
          <h1 className="text-[22px] font-bold tracking-[-0.02em]">
            {stage === "email" ? t("Login to Zenflow") : t("Enter your code")}
          </h1>
          <p className="text-[14px] text-muted-foreground">
            {stage === "email"
              ? t("Tell Zenflow what needs doing. It finds the time.")
              : t("Sent to {email}", { email: hideEmail(sentTo) })}
          </p>
        </div>
      </div>

      <Glass
        frosted
        className="rounded-3xl border p-[18px] shadow-xl shadow-primary/10"
      >
        <Form {...form}>
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col">
            {stage === "email" ? (
              <div key="email" className="flex flex-col animate-rise-in">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[14px] font-semibold">
                        {loginMode === "id" ? t("Student ID") : t("Email")}
                      </FormLabel>
                      <div className="relative">
                        <FormControl>
                          <Input
                            type={loginMode === "id" ? "text" : "email"}
                            inputMode={loginMode === "id" ? "numeric" : "email"}
                            placeholder={
                              loginMode === "id"
                                ? "2012345"
                                : `name@${STUDENT_EMAIL_DOMAIN}`
                            }
                            autoCapitalize="none"
                            autoCorrect="off"
                            autoComplete={loginMode === "id" ? "username" : "email"}
                            autoFocus={loginMode === "email"}
                            disabled={submitting || requestLockout.active}
                            className={cn(
                              "h-11 rounded-full px-4 text-base",
                              loginMode === "id" && "pr-[116px]",
                            )}
                            name={field.name}
                            ref={field.ref}
                            value={field.value}
                            onBlur={field.onBlur}
                            onChange={(e) => {
                              const next = parseLoginInput(
                                e.target.value,
                                loginMode,
                              );
                              clearErrors("email");
                              if (next.mode !== loginMode) setLoginMode(next.mode);
                              field.onChange(next.value);
                            }}
                          />
                        </FormControl>
                        {loginMode === "id" && (
                          <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-[15px] text-muted-foreground">
                            @{STUDENT_EMAIL_DOMAIN}
                          </span>
                        )}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {/* Number keypads have no `@`, so lecturers switch here. */}
                <button
                  type="button"
                  disabled={submitting || requestLockout.active}
                  onClick={() => {
                    const to: LoginMode = loginMode === "id" ? "email" : "id";
                    clearErrors("email");
                    setLoginMode(to);
                    form.setValue(
                      "email",
                      switchLoginMode(form.getValues("email"), to),
                    );
                  }}
                  className="mt-2.5 self-start text-[13px] font-semibold text-primary hover:underline disabled:opacity-50"
                >
                  {loginMode === "id"
                    ? t("Sign in with email")
                    : t("Sign in with student ID")}
                </button>
                {requestLockout.active && (
                  <LockoutNotice>
                    {t("Too many requests. Wait a moment, then try again.")}
                  </LockoutNotice>
                )}

                {requestLockout.active ? (
                  <div className="mt-[18px] flex h-12 items-center justify-center gap-2 rounded-xl bg-muted text-muted-foreground">
                    <Clock3 className="size-4" />
                    <span className="font-semibold tabular-nums">
                      {t("Try again in {time}", { time: formatCountdown(requestLockout.remaining) })}
                    </span>
                  </div>
                ) : (
                  <Button
                    type="submit"
                    className="mt-[18px] h-12 w-full rounded-full text-base"
                    disabled={submitting}
                  >
                    <DelayedSpinner busy={submitting} className="size-4" />
                    {submitting ? t("Sending…") : t("Send OTP")}
                  </Button>
                )}
              </div>
            ) : (
              <div key="otp" className="flex flex-col animate-rise-in">
                <button
                  type="button"
                  disabled={otpLockout.active}
                  onClick={() => {
                    if (otpLockout.active) return;
                    setStage("email");
                    form.setValue("otp", "");
                    clearErrors();
                    otpLockout.clear();
                    resendCooldown.clear();
                  }}
                  className="flex items-center gap-1 self-start text-[13px] font-semibold text-primary disabled:opacity-50"
                >
                  <ArrowLeft className="size-4" />
                  {t("Change email")}
                </button>

                <FormField
                  control={form.control}
                  name="otp"
                  render={({ field }) => (
                    <FormItem className="mt-[18px] mb-[18px] gap-2">
                      <FormLabel className="text-[14px] font-semibold">
                        {t("One-time password")}
                      </FormLabel>
                      <FormControl>
                        <div className="w-full">
                          <InputOTP
                            containerClassName="w-full"
                            maxLength={OTP_LENGTH}
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            autoFocus
                            name={field.name}
                            value={field.value}
                            disabled={submitting || otpLockout.active}
                            onChange={(raw) => {
                              // Pasted text may carry a whole message: keep the code.
                              const next = extractOtp(raw, OTP_LENGTH);
                              field.onChange(next);
                              if (next.length === OTP_LENGTH) {
                                void handleSubmit(onSubmit)();
                              }
                            }}
                          >
                            <InputOTPGroup className="w-full gap-2.5 *:data-[slot=input-otp-slot]:rounded-full *:data-[slot=input-otp-slot]:border">
                              {Array.from({ length: OTP_LENGTH }, (_, i) => (
                                <InputOTPSlot
                                  key={i}
                                  index={i}
                                  className="aspect-square h-auto min-w-0 max-w-12 flex-1 text-[22px] font-semibold"
                                />
                              ))}
                            </InputOTPGroup>
                          </InputOTP>
                        </div>
                      </FormControl>
                      <FormMessage />
                      {otpLockout.active && (
                        <LockoutNotice>
                          {t("Too many attempts. Try again in {time}.", {
                            time: formatCountdown(otpLockout.remaining),
                          })}
                        </LockoutNotice>
                      )}
                    </FormItem>
                  )}
                />

                {submitting ? (
                  <div className="flex items-center justify-center gap-2 text-[14px] text-muted-foreground">
                    <DelayedSpinner busy={submitting} className="size-4" />
                    {t("Verifying code…")}
                  </div>
                ) : otpLockout.active ? (
                  <Button type="button" variant="ghost" className="w-full rounded-full" disabled>
                    {t("Resend code")}
                  </Button>
                ) : requestLockout.active ? (
                  <Button type="button" variant="ghost" className="w-full rounded-full" disabled>
                    <Clock3 className="size-4" />
                    {t("Try again in {time}", { time: formatCountdown(requestLockout.remaining) })}
                  </Button>
                ) : resendCooldown.active ? (
                  <Button type="button" variant="ghost" className="w-full rounded-full" disabled>
                    <Clock3 className="size-4" />
                    {t("Resend code in {time}", { time: formatCountdown(resendCooldown.remaining) })}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full rounded-full text-muted-foreground"
                    disabled={submitting}
                    onClick={() => void handleEmailRequest(sentTo)}
                  >
                    {t("Resend code")}
                  </Button>
                )}
              </div>
            )}
          </form>
        </Form>
      </Glass>

      <p className="px-2.5 text-center text-[13px] leading-[19px] text-foreground/80">
        {t("By continuing, you agree to our")}{" "}
        <a
          href={`${SITE_URL}/terms`}
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-foreground underline underline-offset-4 hover:text-primary"
        >
          {t("Terms of service")}
        </a>{" "}
        {t("and")}{" "}
        <a
          href={`${SITE_URL}/privacy`}
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-foreground underline underline-offset-4 hover:text-primary"
        >
          {t("Privacy policy")}
        </a>
        .
      </p>
    </div>
  );
}
