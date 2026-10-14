"use client";

import { useEffect, useState, type ButtonHTMLAttributes, type MouseEvent } from "react";

type ConfirmSubmitButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "onClick"> & {
  label: string;
  confirmLabel?: string;
  resetAfterMs?: number;
};

export function ConfirmSubmitButton({
  label,
  confirmLabel = "Confirmar",
  resetAfterMs = 6000,
  disabled,
  ...props
}: ConfirmSubmitButtonProps) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timeout = window.setTimeout(() => setArmed(false), resetAfterMs);
    return () => window.clearTimeout(timeout);
  }, [armed, resetAfterMs]);

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (armed) return;
    event.preventDefault();
    setArmed(true);
  }

  return (
    <button
      {...props}
      type="submit"
      disabled={disabled}
      data-confirming={armed ? "true" : "false"}
      onClick={handleClick}
      onBlur={() => setArmed(false)}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}
