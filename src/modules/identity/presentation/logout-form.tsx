"use client";

import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useTerminateSessionMutation } from "./hooks/use-session-mutations";

export function LogoutForm() {
  const [error, setError] = useState("");
  const terminateMutation = useTerminateSessionMutation();
  const form = useForm({
    defaultValues: {},
    onSubmit: async () => {
      setError("");
      try {
        window.location.assign(await terminateMutation.mutateAsync());
      } catch {
        setError("Tidak dapat keluar. Coba lagi.");
      }
    }
  });

  return (
    <form onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}>
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (
          <button className="logout-button" type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
            {isSubmitting ? "Keluar…" : "Keluar"}
          </button>
        )}
      </form.Subscribe>
      {error && <p className="form-status" role="alert">{error}</p>}
    </form>
  );
}
