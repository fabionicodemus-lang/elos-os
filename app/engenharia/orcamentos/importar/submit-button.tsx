"use client";

import { useFormStatus } from "react-dom";

export function ImportSubmitButton({ children, pendingLabel, disabled = false }: {
  children: React.ReactNode;
  pendingLabel: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return <button type="submit" className="elos-button budget-primary-button" disabled={disabled || pending} aria-disabled={disabled || pending}>{pending ? pendingLabel : children}</button>;
}
