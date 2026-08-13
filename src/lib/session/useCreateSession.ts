"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { generateCode } from "./code";
import { claimHost } from "./useSession";

/**
 * Mint a room code and go to it.
 *
 * One place, because the ordering matters and is invisible at the call site:
 * `claimHost` must be written *before* navigating, since the room reads that key at
 * mount to decide whether it is host. Reversed, the creator arrives as a guest and
 * nobody can start the countdown.
 */
export function useCreateSession() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  function create() {
    setCreating(true);
    const code = generateCode();
    claimHost(code);
    router.push(`/room/${code}`);
  }

  return { create, creating };
}
