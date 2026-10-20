import { useSearchParams } from "react-router-dom";

export type ViewState = "ready" | "loading" | "empty";

const STATES: ViewState[] = ["ready", "loading", "empty"];

/** Mockup only: `?state=loading|empty` previews the other states of a screen. */
export function useViewState(): [ViewState, (next: ViewState) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get("state");
  const state = STATES.find((s) => s === raw) ?? "ready";
  const set = (next: ViewState) =>
    setParams(next === "ready" ? {} : { state: next }, { replace: true });
  return [state, set];
}
