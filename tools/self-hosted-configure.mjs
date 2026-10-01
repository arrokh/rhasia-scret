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
import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";
import { build } from "esbuild";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  findExistingSelfHostedDatabaseVolumeWithoutEnvironment,
  isDnsName,
  setEnvValue,
  validateSelfHostedEnvironment,
} from "./self-hosted.mjs";
import { parseCanonicalOrigin } from "./self-hosted-origin.mjs";
import { renderConfigurationPage } from "./self-hosted-configure-page.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SESSION_COOKIE = "rhasia_setup_session";
const MAX_REQUEST_BYTES = 16 * 1024;
const SESSION_LIFETIME_MS = 10 * 60 * 1000;
const defaultSetupValues = {
  authBackend: "none",
  tailscaleMode: "none",
  webOrigin: "http://localhost:3000",
  turnstileSiteKey: "",
  turnstileSecretKey: "",
  smtpHost: "",
  smtpPort: "587",
  smtpUser: "",
  smtpPassword: "",
  authEmailFrom: "",
  authEmailFromName: "rhasia-scret",
  passkeyEnabled: false,
  passkeyRpId: "",
  passkeyOrigin: "",
  appBindAddress: "127.0.0.1",
  appPort: "3000",
};
const setupSubmissionSchema = z
  .object({
    authBackend: z.enum(["none", "passwordless"]),
    tailscaleMode: z.enum(["none", "serve", "funnel"]),
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
    tailscaleMode: "Ekspos aplikasi melalui Tailscale setelah instalasi",
    tailscaleModeNone: "Jangan aktifkan Tailscale",
    tailscaleModeServe: "Serve — hanya untuk tailnet",
    tailscaleModeFunnel: "Funnel — publik di internet",
    tailscaleModeHelp: "Install akan mengaktifkan pilihan Tailscale ini setelah aplikasi sehat.",
    tailscaleFunnelHelp:
      "Funnel dapat diakses publik. Setelah aplikasi sehat, install akan meminta Anda mengetik PUBLIC sebelum dibuka ke internet.",
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
    existingDatabaseVolume:
      "Volume data PostgreSQL self-hosted {volume} sudah ada, tetapi .env tidak ditemukan. Pulihkan .env asli yang berisi password database volume tersebut sebelum konfigurasi.",
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
      "Link login email membutuhkan akun SMTP dan pengaturan Turnstile produksi. Mode ini mengaktifkan fitur Brankas hosted setelah pengguna login. Passwordless tetap berlaku bila aplikasi diekspos melalui Tailscale.",
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
    tailscaleMode: "Expose the app through Tailscale after installation",
    tailscaleModeNone: "Do not enable Tailscale",
    tailscaleModeServe: "Serve — tailnet only",
    tailscaleModeFunnel: "Funnel — public internet",
    tailscaleModeHelp: "Install enables this Tailscale selection after the app is healthy.",
    tailscaleFunnelHelp:
      "Funnel is publicly reachable. After the app is healthy, install asks you to type PUBLIC before opening it to the internet.",
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
    existingDatabaseVolume:
      "Existing self-hosted PostgreSQL data volume {volume} was found, but .env is missing. Restore the original .env containing that volume's database password before configuring.",
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
      "Email sign-in links require a production SMTP account and Turnstile settings. This mode enables hosted Vault features after users sign in. Passwordless remains available when the app is exposed through Tailscale.",
    passwordlessOption: "Passwordless",
  },
};

const terminalCopy = {
  id: {
    intro:
      "Jawab pertanyaan berikut untuk membuat .env. Input rahasia disembunyikan saat diketik. File yang sudah ada tidak akan ditimpa.",
    chooseLanguage: "Bahasa / Language [id/en] (id): ",
    chooseLanguageError: "Masukkan id atau en / Enter id or en.",
    chooseAuthBackend: "Pilih autentikasi aplikasi [1/2] (1): ",
    authSection: "Opsi autentikasi",
    originSection: "Alamat aplikasi",
    networkingSection: "Pengaturan tambahan",
    tailscaleSection: "Eksposur Tailscale",
    tailscaleDetected: "Tailscale aktif dengan origin MagicDNS {origin}.",
    tailscaleOptions: [
      { value: "1", label: "Lewati Tailscale dan lanjutkan setup biasa." },
      { value: "2", label: "Serve", description: "Hanya dapat diakses melalui kebijakan tailnet." },
      {
        value: "3",
        label: "Funnel",
        description: "Dapat diakses publik dari internet; autentikasi aplikasi dipilih terpisah.",
        tone: "warning",
      },
    ],
    chooseTailscaleExposure: "Pilih eksposur Tailscale untuk instalasi ini [1/2/3] (1): ",
    tailscaleAuthNotice:
      "Serve/Funnel memakai origin MagicDNS dan bind loopback. Anda tetap dapat memilih none atau passwordless untuk autentikasi aplikasi.",
    tailscaleBindLocked:
      "Tailscale mengharuskan bind address 127.0.0.1; alamat ini tidak dapat diubah untuk mode tersebut.",
    tailscaleNotConnected:
      "Tailscale CLI terpasang, tetapi host belum terhubung atau origin MagicDNS belum tersedia. Hubungkan Tailscale lalu jalankan wizard kembali untuk menyiapkan eksposur.",
    tailscaleServeNextStep:
      "pnpm selfhosted:install akan mengaktifkan Serve setelah health check. Jika setup dijalankan per tahap, jalankan pnpm selfhosted:tailscale serve setelah pnpm selfhosted:up.",
    tailscaleFunnelNextStep:
      "pnpm selfhosted:install akan meminta konfirmasi PUBLIC setelah health check sebelum mengaktifkan Funnel. Jika setup dijalankan per tahap, jalankan pnpm selfhosted:tailscale funnel --confirm-public setelah pnpm selfhosted:up.",
    chooseValue: "Pilih salah satu opsi yang ditampilkan.",
    chooseYesNo: "Jawab ya atau tidak.",
    invalid: "Konfigurasi belum valid. Periksa kolom berikut lalu masukkan kembali nilainya:",
    cancelled: "Dibatalkan. Tidak ada konfigurasi yang disimpan.",
    saved: ".env berhasil dibuat dengan izin file 0600. Jalankan pnpm selfhosted:setup untuk melanjutkan.",
    existingDatabaseVolume:
      "Volume data PostgreSQL self-hosted {volume} sudah ada, tetapi .env tidak ditemukan. Pulihkan .env asli yang berisi password database volume tersebut sebelum konfigurasi.",
    nextSteps: "Langkah berikutnya",
    terminalRequired:
      "Wizard terminal memerlukan terminal interaktif (TTY) / The terminal wizard requires an interactive terminal (TTY).",
  },
  en: {
    intro:
      "Answer the following questions to create .env. Secret input is hidden as you type. An existing file will not be overwritten.",
    chooseLanguage: "Language / Bahasa [id/en] (id): ",
    chooseLanguageError: "Enter id or en / Masukkan id atau en.",
    chooseAuthBackend: "Choose application authentication [1/2] (1): ",
    authSection: "Authentication options",
    originSection: "Application address",
    networkingSection: "Additional settings",
    tailscaleSection: "Tailscale exposure",
    tailscaleDetected: "Tailscale is connected with MagicDNS origin {origin}.",
    tailscaleOptions: [
      { value: "1", label: "Skip Tailscale and continue with regular setup." },
      { value: "2", label: "Serve", description: "Reachable only under tailnet policy." },
      {
        value: "3",
        label: "Funnel",
        description: "Publicly reachable from the internet; application authentication is chosen separately.",
        tone: "warning",
      },
    ],
    chooseTailscaleExposure: "Choose Tailscale exposure for this installation [1/2/3] (1): ",
    tailscaleAuthNotice:
      "Serve/Funnel uses the MagicDNS origin and loopback binding. You can still choose none or passwordless for application authentication.",
    tailscaleBindLocked:
      "Tailscale requires the host bind address 127.0.0.1; this address cannot be changed in this mode.",
    tailscaleNotConnected:
      "The Tailscale CLI is installed, but this host is not connected or no MagicDNS origin is available. Connect Tailscale and rerun the wizard to prepare exposure.",
    tailscaleServeNextStep:
      "pnpm selfhosted:install enables Serve after the health check. When setting up each stage separately, run pnpm selfhosted:tailscale serve after pnpm selfhosted:up.",
    tailscaleFunnelNextStep:
      "pnpm selfhosted:install asks you to type PUBLIC after the health check before enabling Funnel. When setting up each stage separately, run pnpm selfhosted:tailscale funnel --confirm-public after pnpm selfhosted:up.",
    chooseValue: "Choose one of the listed options.",
    chooseYesNo: "Answer yes or no.",
    invalid: "The configuration is invalid. Review these fields and enter their values again:",
    cancelled: "Cancelled. No configuration was saved.",
    saved: ".env was created with file mode 0600. Run pnpm selfhosted:setup to continue.",
    existingDatabaseVolume:
      "Existing self-hosted PostgreSQL data volume {volume} was found, but .env is missing. Restore the original .env containing that volume's database password before configuring.",
    nextSteps: "Next steps",
    terminalRequired:
      "The terminal wizard requires an interactive terminal (TTY) / Wizard terminal memerlukan terminal interaktif (TTY).",
  },
};

const terminalStyleCodes = {
  // Approximate the web theme's amber, info, success, warning, and danger colors in ANSI 256-color terminals.
  accent: "1;38;5;214",
  muted: "38;5;244",
  info: "38;5;67",
  success: "1;38;5;71",
  warning: "1;38;5;172",
  error: "1;38;5;167",
  prompt: "1;38;5;214",
  bold: "1",
};

function styleTerminal(value, style) {
  const text = String(value);
  if (!process.stdout.isTTY || process.env.NO_COLOR !== undefined || process.env.TERM === "dumb") return text;
  return `\u001b[${terminalStyleCodes[style]}m${text}\u001b[0m`;
}

function terminalTextWidth() {
  const columns = Number.isInteger(process.stdout.columns) ? process.stdout.columns : 80;
  return Math.max(32, Math.min(96, columns - 2));
}

function wrapTerminalText(value, width = terminalTextWidth()) {
  const lines = [];
  for (const paragraph of String(value).split("\n")) {
    const words = paragraph.trim().split(/\s+/u).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      if (line && line.length + word.length + 1 > width) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    lines.push(line);
  }
  return lines;
}

function printParagraph(value, style = "muted", indent = "") {
  const width = Math.max(24, terminalTextWidth() - indent.length);
  for (const line of wrapTerminalText(value, width)) console.log(`${indent}${styleTerminal(line, style)}`);
}

function printNotice(value, tone = "info") {
  const marker = tone === "warning" ? "!" : tone === "error" ? "x" : tone === "success" ? "✓" : "i";
  const width = Math.max(24, terminalTextWidth() - 4);
  const [firstLine = "", ...continuation] = wrapTerminalText(value, width);
  const write = tone === "error" ? console.error : console.log;
  write(`  ${styleTerminal(`[${marker}]`, tone)} ${styleTerminal(firstLine, tone)}`);
  for (const line of continuation) write(`     ${styleTerminal(line, tone)}`);
}

function printSection(title, tone = "bold") {
  console.log(`\n${styleTerminal("◆", "accent")} ${styleTerminal(title, tone)}`);
}

function printOptionList(options) {
  for (const option of options) {
    const tone = option.tone ?? "accent";
    console.log(`  ${styleTerminal(`[${option.value}]`, tone)} ${styleTerminal(option.label, tone)}`);
    if (option.description) printParagraph(option.description, "muted", "      ");
  }
}

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
  if (root === repositoryRoot) {
    const existingVolume = findExistingSelfHostedDatabaseVolumeWithoutEnvironment({ root });
    if (existingVolume) {
      throw new Error(copy.en.existingDatabaseVolume.replace("{volume}", existingVolume));
    }
  }
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
    const validation = validateSubmission(parsed.data, suggestedTailscaleOrigin);
    if (validation.errors.length > 0) {
      sendJson(response, 400, { error: "invalid_configuration", fields: validation.errors });
      return;
    }

    const useTailscaleProxy =
      validation.submission.authBackend === "passwordless" &&
      validation.submission.tailscaleMode !== "none" &&
      suggestedTailscaleOrigin !== null &&
      validation.submission.webOrigin === suggestedTailscaleOrigin;
    const source = createEnvironmentSource({
      root,
      commitSha,
      submission: validation.submission,
      trustTailscaleProxy: useTailscaleProxy,
    });
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

function validateSubmission(value, tailscaleOrigin) {
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

  if (submission.tailscaleMode !== "none") {
    const expectedOrigin = normalizeTailscaleOrigin(tailscaleOrigin);
    if (!expectedOrigin) errors.push("tailscaleMode:unavailable");
    else if (submission.webOrigin !== expectedOrigin) errors.push("webOrigin:tailscale_origin");
    if (bindAddress !== "127.0.0.1") errors.push("appBindAddress:tailscale_bind");
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
    SELF_HOSTED_TAILSCALE_MODE: submission.tailscaleMode,
  });
  if (environmentErrors.length > 0) errors.push("webOrigin:invalid");
  return { errors: [...new Set(errors)], submission: { ...submission, appBindAddress: bindAddress } };
}

function createEnvironmentSource({ root, commitSha, submission, trustTailscaleProxy = false }) {
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
    AUTH_TRUST_PROXY_HEADERS: usePasswordless && trustTailscaleProxy ? "true" : "false",
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
    SELF_HOSTED_TAILSCALE_MODE: submission.tailscaleMode ?? "none",
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

function isTailscaleInstalled() {
  const result = spawnSync("tailscale", ["version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 2_000,
  });
  return !result.error && result.status === 0;
}

export function applyTerminalTailscaleChoice(choice, detectedOrigin, submission) {
  if (choice === "1") return null;
  const mode = choice === "2" ? "serve" : choice === "3" ? "funnel" : null;
  const origin = normalizeTailscaleOrigin(detectedOrigin);
  if (!mode || !origin) throw new Error("A valid connected Tailscale MagicDNS origin is required for exposure.");
  submission.webOrigin = origin;
  submission.appBindAddress = "127.0.0.1";
  return mode;
}

function normalizeTailscaleOrigin(value) {
  const origin = parseCanonicalOrigin(value);
  if (origin?.protocol !== "https:") return null;
  return isDnsName(origin.hostname) ? origin.origin : null;
}

function isFileExistsError(error) {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

class PromptCancelledError extends Error {
  constructor() {
    super("The terminal setup was cancelled.");
    this.name = "PromptCancelledError";
  }
}

async function configureFromTerminal({ root = repositoryRoot, commitSha, tailscaleOrigin } = {}) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error(terminalCopy.en.terminalRequired);
  }

  const locale = await askLanguage();
  activeTerminalLocale = locale;
  const strings = copy[locale];
  const messages = terminalCopy[locale];
  const envPath = resolve(root, ".env");

  console.log(`\n${styleTerminal("rhasia-scret", "accent")}`);
  console.log(styleTerminal(strings.title, "bold"));
  console.log(styleTerminal("─".repeat(Math.min(48, terminalTextWidth())), "muted"));
  printParagraph(messages.intro);
  console.log("");
  printNotice(strings.privacy, "warning");
  if (existsSync(envPath)) {
    printNotice(strings.conflict, "error");
    process.exitCode = 1;
    return;
  }
  const existingVolume = findExistingSelfHostedDatabaseVolumeWithoutEnvironment({ root });
  if (existingVolume) {
    printNotice(messages.existingDatabaseVolume.replace("{volume}", existingVolume), "error");
    process.exitCode = 1;
    return;
  }

  const suggestedTailscaleOrigin = normalizeTailscaleOrigin(
    tailscaleOrigin === undefined ? discoverTailscaleOrigin() : tailscaleOrigin,
  );
  const submission = { ...defaultSetupValues };
  let tailscaleMode = null;

  if (suggestedTailscaleOrigin) {
    printSection(messages.tailscaleSection);
    printNotice(messages.tailscaleDetected.replace("{origin}", suggestedTailscaleOrigin));
    printNotice(messages.tailscaleAuthNotice, "warning");
    printOptionList(messages.tailscaleOptions);
    const choice = await askChoice(messages.chooseTailscaleExposure, ["1", "2", "3"], "1", messages);
    tailscaleMode = applyTerminalTailscaleChoice(choice, suggestedTailscaleOrigin, submission);
  } else if (isTailscaleInstalled()) {
    printNotice(messages.tailscaleNotConnected, "warning");
  }
  submission.tailscaleMode = tailscaleMode ?? "none";

  printSection(messages.authSection);
  printOptionList([
    { value: "1", label: strings.noneOption, description: strings.noneDescription },
    { value: "2", label: strings.passwordlessOption, description: strings.passwordlessDescription },
  ]);
  const backendChoice = await askChoice(messages.chooseAuthBackend, ["1", "2"], "1", messages);
  submission.authBackend = backendChoice === "1" ? "none" : "passwordless";

  let originDefault = submission.webOrigin;
  if (tailscaleMode) {
    originDefault = suggestedTailscaleOrigin;
  } else if (suggestedTailscaleOrigin) {
    const useDetectedOrigin = await askYesNo(
      strings.useTailscaleOrigin.replace("{origin}", suggestedTailscaleOrigin),
      false,
      locale,
      messages,
    );
    if (useDetectedOrigin) originDefault = suggestedTailscaleOrigin;
  }
  if (!tailscaleMode) printSection(messages.originSection);
  submission.webOrigin = tailscaleMode
    ? originDefault
    : await askText(strings.origin, originDefault, strings.originHelp);

  if (submission.authBackend === "passwordless") {
    printSection(strings.providerTitle);
    submission.turnstileSiteKey = await askText(strings.turnstileSite, "");
    submission.turnstileSecretKey = await askSecret(strings.turnstileSecret);
    submission.smtpHost = await askText(strings.smtpHost, "");
    submission.smtpPort = await askText(strings.smtpPort, submission.smtpPort);
    submission.smtpUser = await askText(strings.smtpUser, "");
    submission.smtpPassword = await askSecret(strings.smtpPassword);
    submission.authEmailFrom = await askText(strings.fromAddress, "");
    submission.authEmailFromName = await askText(strings.fromName, submission.authEmailFromName);
    submission.passkeyEnabled = await askYesNo(strings.passkeyEnabled, false, locale, messages);
    if (submission.passkeyEnabled) {
      const origin = readCanonicalOrigin(submission.webOrigin);
      submission.passkeyRpId = await askText(strings.passkeyRp, origin?.hostname ?? "");
      submission.passkeyOrigin = await askText(strings.passkeyOrigin, origin?.origin ?? "");
    }
  }

  printSection(messages.networkingSection);
  const configureNetworking = await askYesNo(strings.advanced, false, locale, messages);
  if (configureNetworking) {
    if (tailscaleMode) printNotice(messages.tailscaleBindLocked, "info");
    else submission.appBindAddress = await askText(strings.bindAddress, submission.appBindAddress, strings.bindHelp);
    submission.appPort = await askText(strings.appPort, submission.appPort);
  }

  const fieldLabels = {
    webOrigin: strings.origin,
    turnstileSiteKey: strings.turnstileSite,
    turnstileSecretKey: strings.turnstileSecret,
    smtpHost: strings.smtpHost,
    smtpPort: strings.smtpPort,
    smtpUser: strings.smtpUser,
    smtpPassword: strings.smtpPassword,
    authEmailFrom: strings.fromAddress,
    authEmailFromName: strings.fromName,
    passkeyRpId: strings.passkeyRp,
    passkeyOrigin: strings.passkeyOrigin,
    appBindAddress: strings.bindAddress,
    appPort: strings.appPort,
  };
  const secretFields = new Set(["turnstileSecretKey", "smtpPassword"]);

  while (true) {
    const validation = validateTerminalSubmission(submission, suggestedTailscaleOrigin);
    if (validation.errors.length === 0) {
      Object.assign(submission, validation.submission);
      break;
    }

    printSection(messages.invalid, "error");
    const fields = [...new Set(validation.errors.map((error) => error.slice(0, error.indexOf(":"))))];
    for (const field of fields) {
      const label = fieldLabels[field];
      if (!label) continue;
      const rule = validation.errors.find((error) => error.startsWith(`${field}:`))?.slice(field.length + 1);
      const hint =
        rule === "required" ? strings.required : rule === "unsupported" ? strings.unsupported : strings.invalidField;
      printNotice(`${label}: ${hint}`, "error");
      submission[field] = secretFields.has(field) ? await askSecret(label) : await askText(label, submission[field]);
    }
  }

  try {
    const source = createEnvironmentSource({
      root,
      commitSha,
      submission,
      trustTailscaleProxy: Boolean(tailscaleMode && submission.authBackend === "passwordless"),
    });
    writeEnvironmentExclusive(envPath, source);
  } catch (error) {
    if (isFileExistsError(error)) {
      printNotice(strings.conflict, "error");
      process.exitCode = 1;
      return;
    }
    throw new Error(strings.unavailable);
  }

  printNotice(messages.saved, "success");
  if (tailscaleMode) printSection(messages.nextSteps);
  if (tailscaleMode === "serve") printNotice(messages.tailscaleServeNextStep);
  if (tailscaleMode === "funnel") printNotice(messages.tailscaleFunnelNextStep, "warning");
}

function validateTerminalSubmission(value, tailscaleOrigin) {
  const parsed = setupSubmissionSchema.safeParse(value);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => {
      const field = typeof issue.path[0] === "string" ? issue.path[0] : "webOrigin";
      return `${field}:invalid`;
    });
    return { errors, submission: value };
  }
  return validateSubmission(parsed.data, tailscaleOrigin);
}

export async function askLanguage({ ask = askQuestion, notify = printNotice } = {}) {
  while (true) {
    const answer = (await ask(terminalCopy.id.chooseLanguage)).trim().toLowerCase();
    if (!answer || answer === "id") return "id";
    if (answer === "en") return "en";
    notify(terminalCopy.en.chooseLanguageError, "error");
  }
}

async function askChoice(prompt, choices, defaultValue, messages) {
  while (true) {
    const answer = (await askQuestion(prompt)).trim().toLowerCase() || defaultValue;
    if (choices.includes(answer)) return answer;
    printNotice(messages.chooseValue, "error");
  }
}

async function askText(label, defaultValue = "", help) {
  if (help) printNotice(help);
  const defaultHint = defaultValue ? ` [${defaultValue}]` : "";
  const answer = await askQuestion(`${label}${defaultHint}: `);
  return answer.length === 0 ? defaultValue : answer;
}

async function askSecret(label) {
  const input = process.stdin;
  emitKeypressEvents(input);

  return new Promise((resolvePromise, rejectPromise) => {
    const previousRawMode = input.isRaw;
    let value = "";
    let complete = false;

    const finish = (error) => {
      if (complete) return;
      complete = true;
      input.removeListener("keypress", onKeypress);
      input.removeListener("end", onEnd);
      input.setRawMode(previousRawMode);
      process.stdout.write("\n");
      if (error) rejectPromise(error);
      else resolvePromise(value);
    };
    const onEnd = () => finish(new PromptCancelledError());
    const onKeypress = (character, key = {}) => {
      if (key.ctrl && (key.name === "c" || key.name === "d")) {
        finish(new PromptCancelledError());
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        finish();
        return;
      }
      if (key.name === "backspace") {
        value = Array.from(value).slice(0, -1).join("");
        return;
      }
      if (!key.ctrl && !key.meta && character && !/[\u0000-\u001f\u007f]/u.test(character)) value += character;
    };

    try {
      input.setRawMode(true);
      input.on("keypress", onKeypress);
      input.once("end", onEnd);
      input.resume();
      process.stdout.write(`${styleTerminal(label, "prompt")}: `);
    } catch (error) {
      finish(error);
    }
  });
}

async function askYesNo(label, defaultValue, locale, messages) {
  const promptHint = locale === "id" ? (defaultValue ? "[Y/t]" : "[y/T]") : defaultValue ? "[Y/n]" : "[y/N]";
  while (true) {
    const answer = (await askQuestion(`${label} ${promptHint}: `)).trim().toLowerCase();
    if (!answer) return defaultValue;
    if (["y", "yes", "ya"].includes(answer)) return true;
    if (["n", "no", "t", "tidak"].includes(answer)) return false;
    printNotice(messages.chooseYesNo, "error");
  }
}

async function askQuestion(prompt) {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await new Promise((resolvePromise, rejectPromise) => {
      const onSigint = () => rejectPromise(new PromptCancelledError());
      readline.once("SIGINT", onSigint);
      void readline.question(styleTerminal(prompt, "prompt")).then(resolvePromise, rejectPromise);
    });
  } finally {
    readline.close();
  }
}

let activeTerminalLocale = "id";
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length === 0) {
    try {
      await configureFromTerminal();
    } catch (error) {
      if (error instanceof PromptCancelledError) {
        printNotice(terminalCopy[activeTerminalLocale].cancelled, "warning");
        process.exitCode = 130;
      } else {
        printNotice(
          error instanceof Error ? error.message : "Unable to configure the self-hosted environment.",
          "error",
        );
        process.exitCode = 1;
      }
    }
  } else if (arguments_.length === 1 && arguments_[0] === "--interactive") {
    try {
      const wizard = await startConfigurationWizard();
      console.log(`\n${styleTerminal("rhasia-scret", "accent")}`);
      printSection("Local browser setup");
      printNotice(
        `Open ${wizard.url} in a browser on this host. The wizard is available once and only on this computer.`,
      );
      await wizard.closed;
      if (wizard.saved)
        printNotice("Created .env with restrictive permissions. Continue with `pnpm selfhosted:setup`.", "success");
    } catch (error) {
      printNotice(error instanceof Error ? error.message : "Unable to start the local setup wizard.", "error");
      process.exitCode = 1;
    }
  } else {
    printNotice("Usage: pnpm selfhosted:configure [--interactive]", "error");
    process.exitCode = 1;
  }
}
