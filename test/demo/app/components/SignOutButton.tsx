"use client";

export function SignOutButton() {
  return (
    <button
      onClick={async () => {
        await fetch("/api/auth/signout", { method: "POST" });
        window.location.href = "/login";
      }}
      style={{ padding: "6px 12px" }}
    >
      Sign out
    </button>
  );
}
