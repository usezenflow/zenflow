import { updateBasicInfo } from "@/api/users";
import { useUserStore } from "@/hooks/use-user-store";
import type { UpdateUserInput } from "@zenflow/shared";

/** Saves a profile or preference patch and mirrors the response into the user store. Resolves false on failure. */
export async function saveUser(patch: UpdateUserInput): Promise<boolean> {
  try {
    useUserStore.getState().setUser(await updateBasicInfo(patch));
    return true;
  } catch {
    return false;
  }
}
