"use client";

import { wordlist } from "@scure/bip39/wordlists/english.js";

const WORD_COUNT = 6;

export function generateVaultUnlockSecret(): string {
  return Array.from({ length: WORD_COUNT }, () => wordlist[randomIndex(wordlist.length)]).join(" ");
}

function randomIndex(upperBound: number): number {
  const max = 0x1_0000_0000;
  const limit = max - (max % upperBound);
  const bytes = new Uint32Array(1);
  do crypto.getRandomValues(bytes); while (bytes[0] >= limit);
  return bytes[0] % upperBound;
}
