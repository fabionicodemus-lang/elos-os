"use client";
import Link from "next/link";
import type { ReactNode } from "react";

// Keep row and ancestor click handlers from replacing an explicit navigation.
export function ExplicitActionLink({href, children, className}: {href: string; children: ReactNode; className?: string}) {
  return <Link prefetch={false} href={href} className={className} onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>{children}</Link>;
}
