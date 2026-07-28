const crypto = require("crypto");

const HASH_ALGORITHM = "sha256";
const HASH_ITERATIONS = 310000;
const HASH_BYTES = 32;
const SESSION_BYTES = 32;

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  if (!password || typeof password !== "string") {
    throw new Error("Password is required");
  }
  const hash = crypto.pbkdf2Sync(password, salt, HASH_ITERATIONS, HASH_BYTES, HASH_ALGORITHM).toString("hex");
  return `pbkdf2_${HASH_ALGORITHM}$${HASH_ITERATIONS}$${salt}$${hash}`;
}

function verifyPassword(password, encodedHash) {
  if (!password || !encodedHash) return false;
  const parts = String(encodedHash).split("$");
  if (parts.length !== 4 || parts[0] !== `pbkdf2_${HASH_ALGORITHM}`) return false;
  const iterations = Number(parts[1]);
  const salt = parts[2];
  const expected = Buffer.from(parts[3], "hex");
  const actual = crypto.pbkdf2Sync(password, salt, iterations, expected.length, HASH_ALGORITHM);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function createSessionToken() {
  return crypto.randomBytes(SESSION_BYTES).toString("base64url");
}

function hashSessionToken(token, secret) {
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters");
  }
  return crypto.createHmac("sha256", secret).update(token).digest("hex");
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSessionToken,
  hashSessionToken,
};
