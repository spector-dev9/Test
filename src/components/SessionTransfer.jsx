import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import {
  addSessionImportProgressListener,
  cancelSessionImport,
  createSingleFlight,
  exportSessionToFile,
  formatTransferBytes,
  importSessionFromFile,
  isSessionTransferSupported,
  pickSessionExportTarget,
  pickSessionImportFile,
  sessionExportFileName,
  validateSessionImportFile,
} from "../lib/sessionTransfer";

export function SessionTransfer({ sessions, directory, onSessionsRefreshed }) {
  const [transferSessionId, setTransferSessionId] = useState("");
  const [transferBusy, setTransferBusy] = useState("");
  const [transferStatus, setTransferStatus] = useState(null);
  const [importElapsed, setImportElapsed] = useState(0);
  const [importRequestStarted, setImportRequestStarted] = useState(false);
  const transferGuard = useRef(createSingleFlight()).current;
  const mountedRef = useRef(true);
  const importStartedRef = useRef(0);
  const importFinishedRef = useRef(false);

  const sessionOptions = Array.isArray(sessions?.data) ? sessions.data : [];
  const effectiveTransferId = sessionOptions.some(
    (session) => session.id === transferSessionId,
  )
    ? transferSessionId
    : sessionOptions[0]?.id || "";

  useEffect(() => {
    mountedRef.current = true;
    let disposed = false;
    let handle = null;
    if (Capacitor.isNativePlatform() && isSessionTransferSupported()) {
      addSessionImportProgressListener((progress) => {
        if (!mountedRef.current || !progress.message) return;
        setTransferStatus({
          text: progress.message,
          error: false,
          phase: progress.phase,
        });
      })
        .then((listener) => {
          if (disposed) {
            listener?.remove?.();
          } else {
            handle = listener;
          }
        })
        .catch(() => {});
    }
    return () => {
      disposed = true;
      mountedRef.current = false;
      handle?.remove?.();
    };
  }, []);

  useEffect(() => {
    if (transferBusy !== "import" || !importStartedRef.current) {
      setImportElapsed(0);
      return undefined;
    }
    const timer = setInterval(() => {
      if (!mountedRef.current) return;
      setImportElapsed(
        Math.max(0, Math.floor((Date.now() - importStartedRef.current) / 1000)),
      );
    }, 1000);
    return () => clearInterval(timer);
  }, [transferBusy]);

  if (!Capacitor.isNativePlatform() || !isSessionTransferSupported()) {
    return null;
  }

  async function exportSelectedSession() {
    const session = sessionOptions.find(
      (candidate) => candidate.id === effectiveTransferId,
    );
    if (!session || transferBusy || !transferGuard.begin()) return;

    setTransferBusy("export");
    setTransferStatus(null);
    try {
      const target = await pickSessionExportTarget(sessionExportFileName(session));
      if (!target) {
        setTransferStatus({ text: "Export cancelled.", error: false });
        return;
      }
      const { bytes } = await exportSessionToFile({
        sessionID: session.id,
        uri: target.uri,
      });
      setTransferStatus({
        text: `Exported ${formatTransferBytes(bytes)} to ${target.name}.`,
        error: false,
      });
    } catch (failure) {
      setTransferStatus({
        text: failure?.message || "The session could not be exported.",
        error: true,
      });
    } finally {
      transferGuard.end();
      setTransferBusy("");
    }
  }

  async function importSessionFile() {
    if (transferBusy || !transferGuard.begin()) return;

    setTransferBusy("import");
    setImportRequestStarted(false);
    importFinishedRef.current = false;
    setTransferStatus({ text: "Choose an OpenCode session export.", error: false });
    importStartedRef.current = Date.now();
    setImportElapsed(0);
    try {
      const file = await pickSessionImportFile();
      if (!file) {
        setTransferStatus({ text: "Import cancelled.", error: false });
        return;
      }
      const validation = validateSessionImportFile(file);
      if (!validation.ok) {
        throw new Error(validation.error);
      }
      setImportRequestStarted(true);
      setTransferStatus({
        text: `Uploading ${file.name} (${formatTransferBytes(file.size)}) for validation…`,
        error: false,
      });
      const { output } = await importSessionFromFile({
        uri: file.uri,
        directory,
      });
      importFinishedRef.current = true;
      if (!output) {
        throw new Error(
          "The import finished without a confirmation from the local server.",
        );
      }
      setTransferStatus({ text: output, error: false });
      if (typeof onSessionsRefreshed === "function") {
        try {
          const refresh = onSessionsRefreshed();
          if (refresh && typeof refresh.catch === "function") {
            refresh.catch(() => {});
          }
        } catch (ignored) {
          void ignored;
        }
      }
    } catch (failure) {
      setTransferStatus({
        text: failure?.message || "The session could not be imported.",
        error: true,
      });
    } finally {
      importStartedRef.current = 0;
      setImportRequestStarted(false);
      transferGuard.end();
      setTransferBusy("");
    }
  }

  async function cancelImport() {
    if (importFinishedRef.current) return;
    try {
      await cancelSessionImport();
      setTransferStatus({ text: "Cancelling import…", error: false });
    } catch (failure) {
      setTransferStatus({
        text: failure?.message || "The import could not be cancelled.",
        error: true,
      });
    }
  }

  return (
    <div className="panel settings-card session-transfer-card">
      <div className="panel-heading">
        <div>
          <span className="panel-kicker">TRANSFER</span>
          <h2>Import and export</h2>
        </div>
      </div>

      {sessionOptions.length > 0 ? (
        <>
          <label
            className="appearance-copy"
            htmlFor="session-transfer-select"
          >
            <strong>Session to export</strong>
            <small>
              Saves the conversation as OpenCode JSON, the same format the
              opencode export command produces.
            </small>
          </label>
          <select
            id="session-transfer-select"
            className="linux-input-field session-transfer-select"
            value={effectiveTransferId}
            onChange={(event) => setTransferSessionId(event.target.value)}
          >
            {sessionOptions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.title || session.slug || session.id}
              </option>
            ))}
          </select>
        </>
      ) : (
        <p className="panel-note">No sessions to export yet.</p>
      )}

      <div className="settings-runtime-actions">
        <button
          type="button"
          className="primary-button"
          onClick={exportSelectedSession}
          disabled={Boolean(transferBusy) || !effectiveTransferId}
        >
          {transferBusy === "export" ? "Exporting…" : "Export session"}
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={importSessionFile}
          disabled={Boolean(transferBusy)}
        >
          {transferBusy === "import" ? "Importing…" : "Import session"}
        </button>
        {transferBusy === "import" && importRequestStarted ? (
          <button
            type="button"
            className="danger-button"
            onClick={cancelImport}
          >
            Cancel import
          </button>
        ) : null}
      </div>

      {transferStatus ? (
        <p
          className="panel-note"
          role={transferStatus.error ? "alert" : "status"}
        >
          {transferStatus.text}
          {transferBusy === "import" && importElapsed > 0
            ? ` ${importElapsed}s elapsed.`
            : ""}
        </p>
      ) : null}

      <p className="panel-note">
        Export opens the system file saver; import opens a JSON file created by
        export. Files are read and written on this device only. Import is the
        supported way to move a conversation between this app's server and
        another OpenCode server.
      </p>
    </div>
  );
}
