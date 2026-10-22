import { useState } from "react";
import { Capacitor } from "@capacitor/core";
import {
  exportSessionToFile,
  formatTransferBytes,
  importSessionFromFile,
  isSessionTransferSupported,
  pickSessionExportTarget,
  pickSessionImportFile,
  sessionExportFileName,
} from "../lib/sessionTransfer";

export function SessionTransfer({ sessions, onSessionsRefreshed }) {
  const [transferSessionId, setTransferSessionId] = useState("");
  const [transferBusy, setTransferBusy] = useState("");
  const [transferStatus, setTransferStatus] = useState(null);

  const sessionOptions = Array.isArray(sessions?.data) ? sessions.data : [];
  const effectiveTransferId = sessionOptions.some(
    (session) => session.id === transferSessionId,
  )
    ? transferSessionId
    : sessionOptions[0]?.id || "";

  if (!Capacitor.isNativePlatform() || !isSessionTransferSupported()) {
    return null;
  }

  async function exportSelectedSession() {
    const session = sessionOptions.find(
      (candidate) => candidate.id === effectiveTransferId,
    );
    if (!session || transferBusy) return;

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
      setTransferBusy("");
    }
  }

  async function importSessionFile() {
    if (transferBusy) return;

    setTransferBusy("import");
    setTransferStatus(null);
    try {
      const file = await pickSessionImportFile();
      if (!file) {
        setTransferStatus({ text: "Import cancelled.", error: false });
        return;
      }
      const { output } = await importSessionFromFile({ uri: file.uri });
      if (typeof onSessionsRefreshed === "function") onSessionsRefreshed();
      setTransferStatus({
        text: `${output || "Session imported."} If it does not appear right away, restart the local server.`,
        error: false,
      });
    } catch (failure) {
      setTransferStatus({
        text: failure?.message || "The session could not be imported.",
        error: true,
      });
    } finally {
      setTransferBusy("");
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
      </div>

      {transferStatus ? (
        <p
          className="panel-note"
          role={transferStatus.error ? "alert" : "status"}
        >
          {transferStatus.text}
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
