/** The student ID in a DLU address (`2123456@dlu.edu.vn` gives `2123456`); null otherwise. */
export function studentIdOf(email: string | null | undefined): string | null {
  const at = email?.lastIndexOf("@") ?? -1;
  if (!email || at <= 0) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (domain !== "dlu.edu.vn" && !domain.endsWith(".dlu.edu.vn")) return null;
  return email.slice(0, at).trim().toLowerCase();
}
