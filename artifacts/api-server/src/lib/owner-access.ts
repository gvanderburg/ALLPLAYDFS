// Only verified Clerk session IDs may be passed here. This server-only allowlist
// is controlled by the project operator, never by a request body or user metadata.
export function isOwnerAccount(userId: string | null | undefined): boolean {
  if (!userId || !/^user_[A-Za-z0-9]+$/.test(userId)) return false;
  const allowed = (process.env.ALLPLAY_OWNER_USER_IDS ?? "").split(",")
    .map(value => value.trim()).filter(value => /^user_[A-Za-z0-9]+$/.test(value));
  return allowed.includes(userId);
}
