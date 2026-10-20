import { Capacitor, registerPlugin } from "@capacitor/core";
import { parsePtyMessage } from "./pty.js";

const NativePtySocket = Capacitor.isNativePlatform()
  ? registerPlugin("PtySocket")
  : null;

function browserSocket(url, handlers) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let opened = false;

    socket.binaryType = "arraybuffer";

    socket.onopen = () => {
      opened = true;
      resolve({
        send(data) {
          if (socket.readyState === WebSocket.OPEN) socket.send(data);
        },
        close() {
          socket.close();
        },
      });
    };

    socket.onmessage = async (event) => {
      let data = event.data;

      if (data instanceof Blob) {
        try {
          data = await data.arrayBuffer();
        } catch {
          return;
        }
      }

      const message = parsePtyMessage(data);
      if (message.kind === "output") handlers.onMessage(message.text);
    };

    socket.onerror = () => {
      if (!opened) {
        reject(new Error("The terminal connection could not be opened."));
        return;
      }

      handlers.onError?.(
        new Error("The terminal connection was interrupted."),
      );
    };

    socket.onclose = () => {
      if (!opened) {
        reject(new Error("The terminal connection could not be opened."));
        return;
      }

      handlers.onClose?.();
    };
  });
}

async function nativeSocket(url, handlers) {
  const id = `ptyws_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2)}`;
  const listeners = [];
  let closed = false;

  async function listen(event, callback) {
    const handle = await NativePtySocket.addListener(event, (payload) => {
      if (closed || payload?.id !== id) return;
      callback(payload);
    });

    listeners.push(handle);
  }

  async function cleanup() {
    closed = true;
    await Promise.all(listeners.map((handle) => handle.remove()));
  }

  await listen("message", (payload) => {
    if (typeof payload.text === "string") handlers.onMessage(payload.text);
  });
  await listen("closed", () => {
    if (closed) return;
    handlers.onClose?.();
  });
  await listen("failure", (payload) => {
    if (closed) return;
    handlers.onError?.(
      new Error(payload.message || "The terminal connection was interrupted."),
    );
  });

  try {
    await NativePtySocket.connect({ id, url });
  } catch (failure) {
    await cleanup();
    throw failure;
  }

  return {
    send(data) {
      if (closed) return;
      NativePtySocket.send({ id, data }).catch(() => {});
    },
    close() {
      if (closed) return;
      NativePtySocket.close({ id }).catch(() => {});
      cleanup().catch(() => {});
    },
  };
}

export function openPtySocket(url, handlers) {
  if (NativePtySocket) return nativeSocket(url, handlers);
  return browserSocket(url, handlers);
}
