import type { FreeSlotsResponse, RecapResponse, ReplanApplied, ReplanChange, ReplanPreview } from "@zenflow/shared";
import { format } from "date-fns";
import { api } from "./base";
import { notifySessionsMutated } from "@/lib/session-cache";

const range = (from: Date, to: Date) => ({ from: format(from, "yyyy-MM-dd"), to: format(to, "yyyy-MM-dd") });

export async function getRecap(from: Date, to: Date): Promise<RecapResponse> {
  const { data } = await api.get("/sessions/recap", { params: range(from, to) });
  return data.data;
}

export async function getFreeSlots(from: Date, to: Date, durationMinutes: number): Promise<FreeSlotsResponse> {
  const { data } = await api.get("/sessions/free-slots", { params: { ...range(from, to), durationMinutes } });
  return data.data;
}

export async function previewReplan(from: Date, to: Date, change?: ReplanChange): Promise<ReplanPreview> {
  const { data } = await api.post("/sessions/replan", { ...range(from, to), change });
  return data.data;
}

export async function confirmReplan(from: Date, to: Date, change?: ReplanChange): Promise<ReplanApplied> {
  const { data } = await api.post("/sessions/replan/confirm", { ...range(from, to), change });
  notifySessionsMutated();
  return data.data;
}

export async function undoLatest(): Promise<{ restored: unknown[] }> {
  const { data } = await api.post("/sessions/undo-latest");
  notifySessionsMutated();
  return data.data;
}
