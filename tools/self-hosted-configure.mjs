import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fsyncSync,
  linkSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { isIPv4 } from "node:net";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { isDnsName, setEnvValue, validateSelfHostedEnvironment } from "./self-hosted.mjs";
import { parseCanonicalOrigin } from "./self-hosted-origin.mjs";
import { renderConfigurationPage } from "./self-hosted-configure-page.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SESSION_COOKIE = "rhasia_setup_session";
const MAX_REQUEST_BYTES = 16 * 1024;
const SESSION_LIFETIME_MS = 10 * 60 * 1000;
const setupSubmissionSchema = z
  .object({
    authBackend: z.enum(["none", "passwordless"]),
    webOrigin: z.string().max(512),
    turnstileSiteKey: z.string().max(1024),
    turnstileSecretKey: z.string().max(1024),
    smtpHost: z.string().max(255),
    smtpPort: z.string().max(5),
    smtpUser: z.string().max(512),
    smtpPassword: z.string().max(1024),
    authEmailFrom: z.string().max(255),
    authEmailFromName: z.string().max(255),
    passkeyEnabled: z.boolean(),
    passkeyRpId: z.string().max(253),
    passkeyOrigin: z.string().max(512),
    appBindAddress: z.string().max(15),
    appPort: z.string().max(5),
  })
  .strict()
  .refine((value) => Object.values(value).every((field) => typeof field !== "string" || !/[\r\n\0]/u.test(field)));

const copy = {
  id: {
    title: "Konfigurasi self-hosted",
    intro:
      "Form lokal sekali pakai ini membuat .env di folder repository. Nilai hanya dikirim ke proses lokal ini; tidak ada analitik atau layanan pihak ketiga.",
    language: "Bahasa",
    backend: "Autentikasi aplikasi",
    origin: "Origin aplikasi kanonis",
    originHelp: "Masukkan origin saja, misalnya https://vault.example.test. Gunakan HTTPS untuk akses non-lokal.",
    providerTitle: "Email dan Turnstile untuk passwordless",
    turnstileSite: "Turnstile site key (publik)",
    turnstileSecret: "Turnstile secret key",
    smtpHost: "SMTP host",
    smtpPort: "SMTP port (465 atau 587)",
    smtpUser: "SMTP username",
    smtpPassword: "SMTP password",
    fromAddress: "Alamat email pengirim",
    fromName: "Nama pengirim",
    useTailscaleOrigin: "Gunakan origin Tailscale yang terdeteksi: {origin}",
    passkeyEnabled: "Konfigurasikan origin passkey",
    passkeyRp: "Passkey RP ID (hostname)",
    passkeyOrigin: "Passkey origin",
    advanced: "Jaringan host (opsional)",
    bindAddress: "IPv4 untuk port host",
    bindHelp:
      "Default 127.0.0.1 membatasi akses ke host; ubah hanya bila reverse proxy lain memerlukan interface berbeda.",
    appPort: "Port aplikasi di host",
    save: "Buat .env",
    cancel: "Batal dan tutup",
    privacy: "Jangan masukkan TOTP, OTP, QR, Vault key, atau konten Vault di sini.",
    saving: "Memvalidasi dan menyimpan konfigurasi…",
    saved: ".env dibuat dengan izin file 0600. Tutup tab ini, lalu jalankan pnpm selfhosted:setup.",
    cancelled: "Wizard ditutup. Tidak ada konfigurasi yang disimpan.",
    invalid: "Konfigurasi belum valid. Periksa kolom yang ditandai dan coba lagi.",
    invalidField: "Periksa nilai pada kolom ini.",
    conflict:
      "File .env sudah ada. Wizard tidak mengubahnya; gunakan langkah manual atau pindahkan file tersebut terlebih dahulu.",
    unavailable:
      "Wizard tidak dapat menyimpan konfigurasi. Tidak ada nilai yang ditampilkan; periksa izin folder lalu jalankan kembali.",
    required: "Kolom ini wajib diisi untuk passwordless.",
    unsupported: "Gunakan setup manual untuk nilai yang memuat tanda kutip tunggal atau backslash.",
    noScript: "Wizard ini memerlukan JavaScript aktif di browser lokal.",
    noneOption: "Tanpa login aplikasi",
    noneDescription:
      "Login Rhasia dinonaktifkan. Brankas hosted, sinkronisasi, keanggotaan, audit, dan pemulihan tidak tersedia. Tailscale Serve mengikuti kebijakan akses tailnet. Funnel dapat diakses publik tanpa login aplikasi.",
    passwordlessDescription:
      "Link login email membutuhkan akun SMTP dan pengaturan Turnstile produksi. Mode ini mengaktifkan fitur Brankas hosted setelah pengguna login. Helper Tailscale repo ini menggunakan mode tanpa login (none).",
    passwordlessOption: "Passwordless",
  },
  en: {
    title: "Self-hosted setup",
    intro:
      "This one-time local form creates .env in the repository folder. Values are sent only to this local process; no analytics or third-party services are used.",
    language: "Language",
    backend: "Application authentication",
    origin: "Canonical application origin",
    originHelp: "Enter only the origin, for example https://vault.example.test. Use HTTPS for non-local access.",
    providerTitle: "Email and Turnstile for passwordless",
    turnstileSite: "Turnstile site key (public)",
    turnstileSecret: "Turnstile secret key",
    smtpHost: "SMTP host",
    smtpPort: "SMTP port (465 or 587)",
    smtpUser: "SMTP username",
    smtpPassword: "SMTP password",
    fromAddress: "Sender email address",
    fromName: "Sender name",
    useTailscaleOrigin: "Use detected Tailscale origin: {origin}",
    passkeyEnabled: "Configure passkey origin",
    passkeyRp: "Passkey RP ID (hostname)",
    passkeyOrigin: "Passkey origin",
    advanced: "Host networking (optional)",
    bindAddress: "Host port IPv4 address",
    bindHelp:
      "The default 127.0.0.1 limits access to this host; change it only when another reverse proxy needs a different interface.",
    appPort: "Application port on host",
    save: "Create .env",
    cancel: "Cancel and close",
    privacy: "Do not enter TOTP, OTP, QR, Vault keys, or Vault content here.",
    saving: "Validating and saving configuration…",
    saved: ".env was created with file mode 0600. Close this tab, then run pnpm selfhosted:setup.",
    cancelled: "The wizard is closed. No configuration was saved.",
    invalid: "The configuration is invalid. Check the highlighted fields and try again.",
    invalidField: "Check this field value.",
    conflict: ".env already exists. The wizard did not change it; use manual setup or move that file first.",
    unavailable:
      "The wizard could not save the configuration. Values were not displayed; check folder permissions and run it again.",
    required: "This field is required for passwordless authentication.",
    unsupported: "Use manual setup for values containing a single quote or backslash.",
    noScript: "This setup wizard requires JavaScript in the local browser.",
    noneOption: "No application sign-in",
    noneDescription:
      "Rhasia sign-in is disabled. Hosted Vault, synchronization, membership, audit, and recovery features are unavailable. Tailscale Serve follows your tailnet access policy. Funnel is publicly reachable without application sign-in.",
    passwordlessDescription:
      "Email sign-in links require a production SMTP account and Turnstile settings. This mode enables hosted Vault features after users sign in. The repository's Tailscale helper uses no-sign-in mode (none).",
    passwordlessOption: "Passwordless",
  },
};

export async function startConfigurationWizard({
  root = repositoryRoot,
  host = "127.0.0.1",
  port = 0,
  commitSha,
  tailscaleOrigin,
} = {}) {
  if (host !== "127.0.0.1") throw new Error("The setup wizard can only bind to 127.0.0.1.");
  const envPath = resolve(root, ".env");
  if (existsSync(envPath)) throw new Error(".env already exists; the setup wizard will not overwrite it.");
  const suggestedTailscaleOrigin = normalizeTailscaleOrigin(
    tailscaleOrigin === undefined ? discoverTailscaleOrigin() : tailscaleOrigin,
  );
  const wizardClientScript = await buildWizardClientScript(repositoryRoot);

  const sessionToken = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + SESSION_LIFETIME_MS;
  let saved = false;
  let server;
  let expiryTimer;
  let resolveClosed;
  const closed = new Promise((resolvePromise) => (resolveClosed = resolvePromise));
  const close = () =>
    new Promise((resolvePromise) => {
      clearTimeout(expiryTimer);
      if (!server?.listening) {
        resolvePromise();
        return;
      }
      server.close(() => resolvePromise());
    });

  server = createServer((request, response) => {
    void handleRequest(request, response).catch(() => {
      if (!response.headersSent) sendJson(response, 500, { error: "unavailable" });
      response.end();
      void close();
    });
  });
  server.once("close", () => resolveClosed());

  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await close();
    throw new Error("Unable to bind the setup wizard to a local address.");
  }
  expiryTimer = setTimeout(() => void close(), SESSION_LIFETIME_MS);
  expiryTimer.unref();

  async function handleRequest(request, response) {
    const expectedHost = `${host}:${address.port}`;
    const origin = `http://${expectedHost}`;
    if (request.socket.remoteAddress !== "127.0.0.1" || request.headers.host !== expectedHost) {
      sendJson(response, 403, { error: "forbidden" });
      return;
    }
    if (request.headers.origin && request.headers.origin !== origin) {
      sendJson(response, 403, { error: "forbidden" });
      return;
    }

    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

    if (request.method === "GET" && request.url === "/") {
      const nonce = randomBytes(18).toString("base64");
      response.setHeader(
        "Content-Security-Policy",
        `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
      );
      response.setHeader(
        "Set-Cookie",
        `${SESSION_COOKIE}=${sessionToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=600`,
      );
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(renderWizardPage(nonce, suggestedTailscaleOrigin));
      return;
    }

    if (!isSessionRequest(request, sessionToken, Date.now() < expiresAt)) {
      sendJson(response, 403, { error: "forbidden" });
      return;
    }

    if (request.method === "GET" && request.url === "/wizard.js") {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      response.end(wizardClientScript);
      return;
    }

    if (request.method === "POST" && request.url === "/cancel") {
      sendJson(response, 200, { cancelled: true });
      response.once("finish", () => void close());
      return;
    }

    if (request.method !== "POST" || request.url !== "/configure") {
      sendJson(response, 404, { error: "not_found" });
      return;
    }
    if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
      sendJson(response, 415, { error: "unsupported_media_type" });
      return;
    }

    let body;
    try {
      body = await readJsonBody(request);
    } catch {
      sendJson(response, 400, { error: "invalid_request" });
      return;
    }
    const parsed = setupSubmissionSchema.safeParse(body);
    if (!parsed.success) {
      sendJson(response, 400, { error: "invalid_request" });
      return;
    }
    const validation = validateSubmission(parsed.data);
    if (validation.errors.length > 0) {
      sendJson(response, 400, { error: "invalid_configuration", fields: validation.errors });
      return;
    }

    const source = createEnvironmentSource({ root, commitSha, submission: validation.submission });
    try {
      writeEnvironmentExclusive(envPath, source);
    } catch (error) {
      if (isFileExistsError(error)) {
        sendJson(response, 409, { error: "env_exists" });
        response.once("finish", () => void close());
        return;
      }
      throw error;
    }

    saved = true;
    sendJson(response, 201, { saved: true });
    response.once("finish", () => void close());
  }

  return {
    url: `http://${host}:${address.port}/`,
    closed,
    close,
    get saved() {
      return saved;
    },
  };
}

function isSessionRequest(request, sessionToken, sessionActive) {
  if (!sessionActive) return false;
  const cookie = request.headers.cookie
    ?.split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${SESSION_COOKIE}=`));
  if (!cookie) return false;
  const provided = Buffer.from(cookie.slice(SESSION_COOKIE.length + 1));
  const expected = Buffer.from(sessionToken);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

async function buildWizardClientScript(root) {
  const result = await build({
    absWorkingDir: root,
    entryPoints: [resolve(root, "tools/self-hosted-configure-client.tsx")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: ["chrome108", "safari16"],
    jsx: "automatic",
    minify: true,
    legalComments: "none",
    nodePaths: [resolve(root, "apps/web/node_modules"), resolve(root, "node_modules")],
  });
  const output = result.outputFiles[0]?.text;
  if (!output) throw new Error("Unable to build the local setup form client.");
  return output;
}

async function readJsonBody(request) {
  const chunks = [];
  let byteLength = 0;
  for await (const chunk of request) {
    byteLength += chunk.length;
    if (byteLength > MAX_REQUEST_BYTES) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Request body must be an object.");
  return value;
}

function validateSubmission(value) {
  const errors = [];
  const submission = Object.fromEntries(
    Object.entries(value).map(([field, candidate]) => [
      field,
      field === "passkeyEnabled" || field === "smtpPassword" ? candidate : candidate.trim(),
    ]),
  );
  for (const [field, candidate] of Object.entries(submission)) {
    if (typeof candidate === "string" && (candidate.includes("\\") || candidate.includes("'"))) {
      errors.push(`${field}:unsupported`);
    }
  }

  if (errors.length > 0) return { errors, submission };
  const origin = readCanonicalOrigin(submission.webOrigin);
  if (!origin) errors.push("webOrigin:invalid");
  else submission.webOrigin = origin.origin;
  const bindAddress = submission.appBindAddress || "127.0.0.1";
  if (!isIPv4(bindAddress)) errors.push("appBindAddress:invalid");
  if (!/^\d+$/u.test(submission.appPort) || Number(submission.appPort) < 1 || Number(submission.appPort) > 65535) {
    errors.push("appPort:invalid");
  }

  if (submission.authBackend === "passwordless") {
    for (const field of [
      "turnstileSiteKey",
      "turnstileSecretKey",
      "smtpHost",
      "smtpPort",
      "smtpUser",
      "smtpPassword",
      "authEmailFrom",
      "authEmailFromName",
    ]) {
      if (!submission[field].trim()) errors.push(`${field}:required`);
    }
    if (submission.smtpHost && /\s|[/\\]/u.test(submission.smtpHost)) errors.push("smtpHost:invalid");
    if (!/^\d+$/u.test(submission.smtpPort) || ![465, 587].includes(Number(submission.smtpPort))) {
      errors.push("smtpPort:invalid");
    }
    if (submission.authEmailFrom && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(submission.authEmailFrom)) {
      errors.push("authEmailFrom:invalid");
    }
    if (origin && !isLocalOrigin(origin)) {
      if (
        submission.turnstileSiteKey === "1x00000000000000000000AA" ||
        submission.turnstileSecretKey === "1x0000000000000000000000000000000AA"
      )
        errors.push("turnstileSecretKey:testing_key");
    }
    if (submission.passkeyEnabled) {
      const passkeyOrigin = readCanonicalOrigin(submission.passkeyOrigin);
      if (!passkeyOrigin || !submission.passkeyRpId) errors.push("passkeyOrigin:invalid");
      else if (passkeyOrigin.hostname !== submission.passkeyRpId) errors.push("passkeyRpId:mismatch");
      else if (!origin || passkeyOrigin.origin !== origin.origin) errors.push("passkeyOrigin:mismatch");
      else submission.passkeyOrigin = passkeyOrigin.origin;
    } else if (submission.passkeyRpId || submission.passkeyOrigin) {
      errors.push("passkeyOrigin:unexpected");
    }
  }

  const environmentErrors = validateSelfHostedEnvironment({
    POSTGRES_PASSWORD: "synthetic-database-password",
    PROXY_SECRET: "p".repeat(32),
    API_PROXY_SECRET: "p".repeat(32),
    CRON_SECRET: "c".repeat(32),
    AUTH_BACKEND: submission.authBackend,
    WEB_ORIGIN: submission.webOrigin,
    API_ORIGIN: "http://localhost:8787",
    AUTH_APP_ORIGIN: submission.webOrigin,
    APP_BIND_ADDRESS: bindAddress,
    APP_PORT: submission.appPort,
  });
  if (environmentErrors.length > 0) errors.push("webOrigin:invalid");
  return { errors: [...new Set(errors)], submission: { ...submission, appBindAddress: bindAddress } };
}

function createEnvironmentSource({ root, commitSha, submission }) {
  const examplePath = resolve(root, ".env.example");
  const exampleSource = readFileSync(examplePath, "utf8");
  const origin = submission.webOrigin;
  const databasePassword = randomSecret();
  const proxySecret = randomSecret();
  const magicLinkSecret = randomSecret();
  const sessionSecret = randomSecret();
  const usePasswordless = submission.authBackend === "passwordless";
  const values = {
    AUTH_BACKEND: submission.authBackend,
    WEB_ORIGIN: origin,
    API_ORIGIN: "http://localhost:8787",
    PROXY_SECRET: proxySecret,
    API_PROXY_SECRET: proxySecret,
    AUTH_APP_ORIGIN: usePasswordless ? origin : "",
    AUTH_TRUST_PROXY_HEADERS: "false",
    AUTH_MAGIC_LINK_SECRET: magicLinkSecret,
    AUTH_SESSION_SECRET: sessionSecret,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: usePasswordless ? submission.turnstileSiteKey : "",
    TURNSTILE_SECRET_KEY: usePasswordless ? submission.turnstileSecretKey : "",
    SMTP_HOST: usePasswordless ? submission.smtpHost : "",
    SMTP_PORT: usePasswordless ? submission.smtpPort : "",
    SMTP_SECURE: usePasswordless && submission.smtpPort === "465" ? "true" : "false",
    SMTP_REQUIRE_TLS: usePasswordless && submission.smtpPort !== "465" ? "true" : "false",
    SMTP_USER: usePasswordless ? submission.smtpUser : "",
    SMTP_PASSWORD: usePasswordless ? submission.smtpPassword : "",
    AUTH_EMAIL_FROM: usePasswordless ? submission.authEmailFrom : "",
    AUTH_EMAIL_FROM_NAME: usePasswordless ? submission.authEmailFromName : "",
    PASSKEY_RP_ID: usePasswordless && submission.passkeyEnabled ? submission.passkeyRpId : "",
    PASSKEY_ORIGIN: usePasswordless && submission.passkeyEnabled ? submission.passkeyOrigin : "",
    CRON_SECRET: randomSecret(),
    DATABASE_URL: localDatabaseUrl(databasePassword),
    DIRECT_URL: localDatabaseUrl(databasePassword),
    POSTGRES_PASSWORD: databasePassword,
    APP_BIND_ADDRESS: submission.appBindAddress,
    APP_PORT: submission.appPort,
    COMMIT_SHA: commitSha ?? readCommitSha(root),
  };
  return Object.entries(values).reduce(
    (source, [name, value]) => setEnvValue(source, name, dotenvValue(value)),
    exampleSource,
  );
}

function writeEnvironmentExclusive(path, source) {
  const temporaryPath = `${path}.setup-${randomBytes(12).toString("hex")}`;
  let descriptor;
  try {
    descriptor = openSync(temporaryPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, source, { encoding: "utf8" });
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    linkSync(temporaryPath, path);
    unlinkSync(temporaryPath);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function renderWizardPage(nonce, tailscaleOrigin) {
  return renderConfigurationPage(nonce, tailscaleOrigin, copy);
}
function sendJson(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function readCanonicalOrigin(value) {
  const origin = parseCanonicalOrigin(value);
  if (origin?.protocol !== "https:" && (!origin || !isLocalOrigin(origin))) return undefined;
  return origin;
}

function isLocalOrigin(value) {
  return value.protocol === "http:" && ["localhost", "127.0.0.1"].includes(value.hostname);
}

function dotenvValue(value) {
  if (/[\r\n\0\\']/u.test(value))
    throw new Error("Use manual .env setup for values that cannot be represented safely.");
  if (!/[\s#$"`]/u.test(value)) return value;
  return `'${value}'`;
}

function localDatabaseUrl(password) {
  return `postgresql://rhasia:${password}@127.0.0.1:55432/shared_totp_vault?schema=public`;
}

function randomSecret() {
  return randomBytes(32).toString("hex");
}

function readCommitSha(root) {
  const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0 || !result.stdout.trim()) throw new Error("Unable to determine the current Git commit SHA.");
  return result.stdout.trim();
}

function discoverTailscaleOrigin() {
  const result = spawnSync("tailscale", ["status", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 2_000,
  });
  if (result.error || result.status !== 0) return null;
  try {
    const status = JSON.parse(result.stdout);
    if (status?.BackendState !== "Running") return null;
    const hostname = status?.Self?.DNSName?.trim().replace(/\.$/u, "").toLowerCase();
    if (!hostname || !isDnsName(hostname)) return null;
    return `https://${hostname}`;
  } catch {
    return null;
  }
}

function normalizeTailscaleOrigin(value) {
  const origin = parseCanonicalOrigin(value);
  if (origin?.protocol !== "https:") return null;
  return isDnsName(origin.hostname) ? origin.origin : null;
}

function isFileExistsError(error) {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== "--interactive") {
    console.error("Usage: pnpm selfhosted:configure --interactive");
    process.exitCode = 1;
  } else {
    try {
      const wizard = await startConfigurationWizard();
      console.log(
        `Open ${wizard.url} in a browser on this host. The wizard is available once and only on this computer.`,
      );
      await wizard.closed;
      if (wizard.saved)
        console.log("Created .env with restrictive permissions. Continue with `pnpm selfhosted:setup`.");
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Unable to start the local setup wizard.");
      process.exitCode = 1;
    }
  }
}
