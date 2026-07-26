import { Show, SignInButton, UserButton, useUser } from "@clerk/react";

/**
 * Sidebar auth block — Clerk hosted sign-in + user menu.
 */
export function AuthPanel() {
  const { user, isLoaded } = useUser();

  if (!isLoaded) {
    return (
      <div className="auth-panel">
        <p className="settings-meta">Loading account…</p>
      </div>
    );
  }

  return (
    <div className="auth-panel">
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button type="button" className="btn new-chat-btn auth-sign-in">
            Sign in
          </button>
        </SignInButton>
        <p className="settings-meta">
          Sign in to keep chats & memory on this device under your account
        </p>
      </Show>
      <Show when="signed-in">
        <div className="auth-user-row">
          <UserButton
            appearance={{
              elements: {
                avatarBox: { width: 36, height: 36 },
              },
            }}
          />
          <div className="auth-user-meta">
            <div className="auth-user-name">
              {user?.firstName ||
                user?.username ||
                user?.primaryEmailAddress?.emailAddress ||
                "Signed in"}
            </div>
            <div className="settings-meta">Account active</div>
          </div>
        </div>
      </Show>
    </div>
  );
}
