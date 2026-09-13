"use client";

import { useEffect } from "react";
import { announceAuthenticationCompletion } from "./auth-completion-channel";

export function AuthCompletionAnnouncement() {
  useEffect(() => {
    announceAuthenticationCompletion();
  }, []);

  return null;
}
