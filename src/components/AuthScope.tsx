import { useAuth, useUser } from "@clerk/react";
import { useEffect, type ReactNode } from "react";
import { setDisplayName, loadMemory } from "../lib/memory";
import { setStorageScope } from "../lib/storageScope";

type Props = {
  children: ReactNode;
  /** Called when storage scope changes so App can reload threads/memory */
  onScopeChange?: (userId: string | null) => void;
};

/**
 * Keeps localStorage keys scoped to the signed-in Clerk user.
 */
export function AuthScope({ children, onScopeChange }: Props) {
  const { isLoaded, userId, isSignedIn } = useAuth();
  const { user } = useUser();

  useEffect(() => {
    if (!isLoaded) return;
    const id = isSignedIn ? userId ?? null : null;
    setStorageScope(id);
    onScopeChange?.(id);

    // Seed display name from Clerk once if empty
    if (isSignedIn && user) {
      const mem = loadMemory();
      if (!mem.displayName) {
        const name =
          user.firstName ||
          user.fullName ||
          user.username ||
          user.primaryEmailAddress?.emailAddress?.split("@")[0] ||
          "";
        if (name) setDisplayName(name);
      }
    }
  }, [isLoaded, isSignedIn, userId, user, onScopeChange]);

  return <>{children}</>;
}
