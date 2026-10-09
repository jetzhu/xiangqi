// The player's avatar, in the header and on the profile page (kept small: every page loads it).
import { avatarFace } from "./avatar.js";
import type { AccountUser } from "./session.js";

/** The player's avatar: their chosen piece, or the first letter of their username. */
export function UserAvatar({ user, size = 28 }: { user: Pick<AccountUser, "avatar" | "username">; size?: number }) {
  const face = avatarFace(user.avatar);
  return (
    <span className={`account-avatar${face ? ` piece-${face.color}` : ""}`} style={{ width: size, height: size, fontSize: size * 0.55 }} aria-hidden>
      {face ? face.char : user.username.slice(0, 1).toUpperCase()}
    </span>
  );
}
