import { randomBytes, randomUUID, createHash } from "crypto";

export function makeId() { return randomUUID(); }
export function makeToken(bytes = 32) { return randomBytes(bytes).toString("base64url"); }
export function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }

export function usernameKey(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("fr-FR");
}

export function cleanUsername(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim().slice(0, 18);
}

export function validateUsername(value: string) {
  if (value.length < 3 || value.length > 18) throw new Error("Le pseudo doit faire entre 3 et 18 caractères.");
  if (!/^[\p{L}\p{N}_.-]+$/u.test(value)) throw new Error("Le pseudo peut contenir des lettres, chiffres, _, . et -.");
}

export function cleanRoomCode(value: unknown) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function makeRoomCode() {
  let code = "";
  for (let i = 0; i < 5; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}
