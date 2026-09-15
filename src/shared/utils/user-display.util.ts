import type { User } from "../types/auth.types";

export function getUserDisplayName(user: User): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return name || user.email;
}

export function getUserInitials(user: User): string {
  const first = user.firstName?.trim().charAt(0) ?? "";
  const last = user.lastName?.trim().charAt(0) ?? "";
  const fromName = `${first}${last}`.toUpperCase();
  if (fromName) return fromName;

  const fromEmail = user.email?.trim().charAt(0);
  return fromEmail ? fromEmail.toUpperCase() : "?";
}
