// Credential encryption utilities using AES-256-GCM
// Keys are derived from a master vault key stored securely

import { WebCrypto } from "@aspect-ai/convex-crypto";

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

// Get or derive the master key from environment
async function getMasterKey(): Promise<CryptoKey> {
  const keyHex = process.env.CONVEX_VAULT_KEY;
  
  if (!keyHex) {
    throw new Error("CONVEX_VAULT_KEY environment variable not set");
  }
  
  const keyData = Uint8Array.from(hexToBytes(keyHex));
  
  return await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function hexToBytes(hex: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.slice(i, i + 2), 16));
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Encrypt a credential
export async function encryptCredential(plaintext: string): Promise<{
  encryptedKey: string;
  iv: string;
  tag: string;
}> {
  const key = await getMasterKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    ENCODER.encode(plaintext)
  );
  
  // GCM returns [ciphertext, auth tag] combined
  const encryptedArray = new Uint8Array(encrypted);
  const ciphertext = encryptedArray.slice(0, encryptedArray.length - 16);
  const authTag = encryptedArray.slice(encryptedArray.length - 16);
  
  return {
    encryptedKey: bytesToHex(ciphertext),
    iv: bytesToHex(iv),
    tag: bytesToHex(authTag),
  };
}

// Decrypt a credential
export async function decryptCredential(
  encryptedKey: string,
  iv: string,
  tag: string
): Promise<string> {
  const key = await getMasterKey();
  
  const ciphertext = Uint8Array.from(hexToBytes(encryptedKey));
  const ivArray = Uint8Array.from(hexToBytes(iv));
  const tagArray = Uint8Array.from(hexToBytes(tag));
  
  // Combine ciphertext and tag for decryption
  const combined = new Uint8Array(ciphertext.length + tagArray.length);
  combined.set(ciphertext);
  combined.set(tagArray, ciphertext.length);
  
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivArray },
    key,
    combined
  );
  
  return DECODER.decode(decrypted);
}

// Generate a new vault key (for initial setup)
export function generateVaultKey(): string {
  const key = crypto.getRandomValues(new Uint8Array(32));
  return bytesToHex(key);
}
