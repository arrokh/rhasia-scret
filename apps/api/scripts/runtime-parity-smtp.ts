import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TLSSocket, createSecureContext, type SecureContext } from "node:tls";

type MessageReader = Readonly<{
  next(): Promise<Buffer>;
  dispose(): void;
}>;

export type RuntimeParitySMTP = Readonly<{
  host: "127.0.0.1";
  port: number;
  certificateAuthority: string;
  takeMessage(): Promise<string>;
  close(): Promise<void>;
}>;

export async function startRuntimeParitySMTP(): Promise<RuntimeParitySMTP> {
  const certificate = await createCertificate();
  const secureContext = certificate.secureContext;
  const messages: string[] = [];
  const messageWaiters: Array<(message: string) => void> = [];
  const server = createServer((socket) => {
    void handleConnection(socket, secureContext, messages, messageWaiters);
  });
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("Could not start the local synthetic SMTP server.");
  }

  return {
    host: "127.0.0.1",
    port: address.port,
    certificateAuthority: Buffer.from(certificate.cert, "utf8").toString("base64"),
    async takeMessage(): Promise<string> {
      const queued = messages.shift();
      if (queued !== undefined) return queued;
      return new Promise<string>((resolvePromise, reject) => {
        const timeout = setTimeout(() => {
          const index = messageWaiters.indexOf(waiter);
          if (index >= 0) messageWaiters.splice(index, 1);
          reject(new Error("The local synthetic SMTP server received no message."));
        }, 15_000);
        const waiter = (message: string) => {
          clearTimeout(timeout);
          resolvePromise(message);
        };
        messageWaiters.push(waiter);
      });
    },
    close: () => closeServer(server),
  };
}

async function createCertificate(): Promise<{ cert: string; secureContext: SecureContext }> {
  const directory = await mkdtemp(join(tmpdir(), "rhasia-runtime-parity-smtp-"));
  const keyPath = join(directory, "key.pem");
  const certPath = join(directory, "cert.pem");
  try {
    const result = spawnSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        keyPath,
        "-out",
        certPath,
        "-days",
        "1",
        "-subj",
        "/CN=127.0.0.1",
        "-addext",
        "subjectAltName=IP:127.0.0.1,DNS:localhost",
      ],
      { encoding: "utf8", stdio: ["ignore", "ignore", "ignore"] },
    );
    if (result.error || result.status !== 0) throw new Error("Could not create the ephemeral local SMTP certificate.");
    const [cert, key] = await Promise.all([readFile(certPath, "utf8"), readFile(keyPath, "utf8")]);
    return { cert, secureContext: createSecureContext({ cert, key }) };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function handleConnection(
  socket: Socket,
  secureContext: SecureContext,
  messages: string[],
  waiters: Array<(message: string) => void>,
): Promise<void> {
  let connection: Socket | TLSSocket = socket;
  let reader: MessageReader | undefined;
  try {
    connection.setTimeout(15_000, () => connection.destroy());
    connection.write("220 localhost ESMTP local synthetic test server\r\n");
    reader = createMessageReader(connection);
    let encrypted = false;
    while (true) {
      const command = (await reader.next()).toString("ascii").trim();
      const upperCommand = command.toUpperCase();
      if (upperCommand.startsWith("EHLO ") || upperCommand.startsWith("HELO ")) {
        connection.write(
          encrypted
            ? "250-localhost\r\n250 AUTH PLAIN LOGIN\r\n"
            : "250-localhost\r\n250-STARTTLS\r\n250 AUTH PLAIN LOGIN\r\n",
        );
        continue;
      }
      if (upperCommand === "STARTTLS" && !encrypted) {
        connection.write("220 Ready to start TLS\r\n");
        const plainSocket = connection;
        reader.dispose();
        reader = undefined;
        connection = await upgradeToTLS(plainSocket, secureContext);
        connection.setTimeout(15_000, () => connection.destroy());
        reader = createMessageReader(connection);
        encrypted = true;
        continue;
      }
      if (upperCommand.startsWith("AUTH PLAIN")) {
        if (!encrypted) throw new Error("SMTP authentication was attempted before TLS.");
        if (!upperCommand.slice("AUTH PLAIN".length).trim()) {
          connection.write("334 \r\n");
          await reader.next();
        }
        connection.write("235 2.7.0 Authentication successful\r\n");
        continue;
      }
      if (upperCommand === "AUTH LOGIN") {
        if (!encrypted) throw new Error("SMTP authentication was attempted before TLS.");
        connection.write("334 VXNlcm5hbWU6\r\n");
        await reader.next();
        connection.write("334 UGFzc3dvcmQ6\r\n");
        await reader.next();
        connection.write("235 2.7.0 Authentication successful\r\n");
        continue;
      }
      if (upperCommand.startsWith("MAIL FROM:") || upperCommand.startsWith("RCPT TO:")) {
        if (!encrypted) throw new Error("SMTP envelope was sent before TLS.");
        connection.write("250 2.1.0 Accepted\r\n");
        continue;
      }
      if (upperCommand === "DATA") {
        if (!encrypted) throw new Error("SMTP message was sent before TLS.");
        connection.write("354 End with <CRLF>.<CRLF>\r\n");
        const chunks: Buffer[] = [];
        while (true) {
          const line = await reader.next();
          if (line.equals(Buffer.from(".\r\n"))) break;
          chunks.push(line[0] === 46 && line[1] === 46 ? line.subarray(1) : line);
        }
        const message = Buffer.concat(chunks).toString("utf8");
        const waiter = waiters.shift();
        if (waiter) waiter(message);
        else messages.push(message);
        connection.write("250 2.0.0 Message accepted\r\n");
        continue;
      }
      if (upperCommand === "RSET" || upperCommand === "NOOP") {
        connection.write("250 2.0.0 Accepted\r\n");
        continue;
      }
      if (upperCommand === "QUIT") {
        connection.write("221 2.0.0 Closing connection\r\n");
        reader.dispose();
        connection.end();
        return;
      }
      throw new Error("Unexpected SMTP protocol command.");
    }
  } catch {
    reader?.dispose();
    if (!socket.destroyed) socket.destroy();
  }
}

function createMessageReader(stream: Socket | TLSSocket): MessageReader {
  let buffer = Buffer.alloc(0);
  let failure: Error | undefined;
  const wakeups: Array<() => void> = [];
  const notify = () => {
    for (const wake of wakeups.splice(0)) wake();
  };
  const onData = (chunk: Buffer | string) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    buffer = Buffer.concat([buffer, bytes]);
    notify();
  };
  const onError = () => {
    failure = new Error("SMTP connection failed.");
    notify();
  };
  const onEnd = () => {
    failure = new Error("SMTP connection closed unexpectedly.");
    notify();
  };
  stream.on("data", onData);
  stream.on("error", onError);
  stream.on("end", onEnd);

  return {
    async next(): Promise<Buffer> {
      while (true) {
        const lineEnd = buffer.indexOf("\r\n");
        if (lineEnd >= 0) {
          const line = buffer.subarray(0, lineEnd + 2);
          buffer = buffer.subarray(lineEnd + 2);
          return line;
        }
        if (failure) throw failure;
        await new Promise<void>((resolvePromise) => wakeups.push(resolvePromise));
      }
    },
    dispose(): void {
      stream.off("data", onData);
      stream.off("error", onError);
      stream.off("end", onEnd);
    },
  };
}

async function upgradeToTLS(socket: Socket | TLSSocket, secureContext: SecureContext): Promise<TLSSocket> {
  const secureSocket = new TLSSocket(socket, { isServer: true, secureContext });
  await new Promise<void>((resolvePromise, reject) => {
    secureSocket.once("secure", () => resolvePromise());
    secureSocket.once("error", reject);
  });
  return secureSocket;
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolvePromise, reject) => {
    server.close((error) => (error ? reject(error) : resolvePromise()));
  });
}
