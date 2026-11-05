"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

export function PlatformSubmitButton({
  children, pendingLabel, disabled = false,
}: {
  children: ReactNode;
  pendingLabel: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button className="auth-primary" type="submit" disabled={disabled || pending}>
      {pending ? pendingLabel : children}
    </button>
  );
}
