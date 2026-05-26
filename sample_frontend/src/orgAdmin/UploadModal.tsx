import { useState, useRef, type ChangeEvent } from "react";
import { zarBaseUrl } from "../app/constants";
import type { CanonicalAsset } from "./types";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

type FileStatus =
  | "pending"
  | "hashing"
  | "creating"
  | "uploading"
  | "finalizing"
  | "done"
  | "error";

type FileEntry = {
  localId: string;
  file: File;
  sizeError: boolean;
  status: FileStatus;
  errorMessage?: string;
};

type GetToken = (opts?: { skipCache?: boolean }) => Promise<string | null>;

async function sha256hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function runUpload(
  file: File,
  matterId: string,
  getToken: GetToken,
  onPhase: (phase: FileStatus) => void,
): Promise<CanonicalAsset> {
  onPhase("hashing");
  const buffer = await file.arrayBuffer();
  const hash = await sha256hex(buffer);

  onPhase("creating");
  const token = await getToken({ skipCache: true });
  const createRes = await fetch(`${zarBaseUrl}/matters/${matterId}/upload-attempts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      filename: file.name,
      content_type: file.type || "application/octet-stream",
      size_bytes: file.size,
    }),
  });
  if (!createRes.ok) throw new Error(`Failed to initiate upload (${createRes.status})`);

  const attempt = (await createRes.json()) as {
    upload_attempt_id: string;
    upload_target_url: string | null;
    upload_target_fields: Record<string, string> | null;
    upload_method: string | null;
  };
  if (!attempt.upload_target_url) throw new Error("No upload target URL returned");

  onPhase("uploading");
  const fields = attempt.upload_target_fields ?? {};
  if (Object.keys(fields).length > 0) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    form.append("file", file);
    const s3Res = await fetch(attempt.upload_target_url, { method: "POST", body: form });
    if (!s3Res.ok) throw new Error(`Upload to storage failed (${s3Res.status})`);
  } else {
    const s3Res = await fetch(attempt.upload_target_url, {
      method: attempt.upload_method ?? "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!s3Res.ok) throw new Error(`Upload to storage failed (${s3Res.status})`);
  }

  onPhase("finalizing");
  const finalizeToken = await getToken({ skipCache: true });
  const finalizeRes = await fetch(
    `${zarBaseUrl}/matters/${matterId}/upload-attempts/${attempt.upload_attempt_id}/finalize`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${finalizeToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        untouched_hash_value: hash,
        properties: { filename: file.name, content_type: file.type || "application/octet-stream" },
      }),
    },
  );
  if (!finalizeRes.ok) throw new Error(`Failed to finalize upload (${finalizeRes.status})`);
  return finalizeRes.json() as Promise<CanonicalAsset>;
}

export function UploadModal({
  matterId,
  onClose,
  onAssetCreated,
  getToken,
}: {
  matterId: string;
  onClose: () => void;
  onAssetCreated: (asset: CanonicalAsset) => void;
  getToken: GetToken;
}) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [allDone, setAllDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function addFiles(fileList: FileList) {
    const added: FileEntry[] = Array.from(fileList).map((file) => ({
      localId: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
      file,
      sizeError: file.size > MAX_FILE_BYTES,
      status: "pending",
    }));
    setEntries((prev) => [...prev, ...added]);
  }

  function removeEntry(localId: string) {
    setEntries((prev) => prev.filter((e) => e.localId !== localId));
  }

  function updateEntry(localId: string, update: Partial<FileEntry>) {
    setEntries((prev) => prev.map((e) => (e.localId === localId ? { ...e, ...update } : e)));
  }

  async function startUploads() {
    const valid = entries.filter((e) => !e.sizeError);
    if (valid.length === 0) return;
    setRunning(true);

    await Promise.allSettled(
      valid.map((entry) =>
        runUpload(entry.file, matterId, getToken, (phase) =>
          updateEntry(entry.localId, { status: phase }),
        )
          .then((asset) => {
            updateEntry(entry.localId, { status: "done" });
            onAssetCreated(asset);
          })
          .catch((err: unknown) => {
            updateEntry(entry.localId, {
              status: "error",
              errorMessage: err instanceof Error ? err.message : "Upload failed",
            });
          }),
      ),
    );

    setAllDone(true);
  }

  const validCount = entries.filter((e) => !e.sizeError).length;
  const invalidCount = entries.filter((e) => e.sizeError).length;

  return (
    <div className="modal-backdrop" onClick={running ? undefined : onClose}>
      <div className="modal-card upload-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Upload files</h2>
        </div>
        <div className="modal-body">
          {!running && (
            <label
              className="upload-drop-zone"
              onClick={(e) => {
                e.preventDefault();
                inputRef.current?.click();
              }}
            >
              <input
                ref={inputRef}
                type="file"
                multiple
                className="upload-file-input"
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <span className="upload-placeholder">
                {entries.length > 0 ? "Add more files" : "Choose files or drag and drop"}
              </span>
              <span className="upload-limit-hint">Up to 10 MB per file</span>
            </label>
          )}

          {entries.length > 0 && (
            <ul className="upload-file-list">
              {entries.map((entry) => (
                <li key={entry.localId} className="upload-file-entry">
                  <div className="upload-file-entry-main">
                    <span className="upload-file-entry-name">{entry.file.name}</span>
                    <span className="upload-file-entry-size">{formatBytes(entry.file.size)}</span>
                  </div>
                  <div className="upload-file-entry-status">
                    {entry.sizeError && (
                      <span className="upload-entry-error">Exceeds 10 MB</span>
                    )}
                    {!entry.sizeError && entry.status === "pending" && !running && (
                      <button
                        type="button"
                        className="upload-remove-button"
                        onClick={() => removeEntry(entry.localId)}
                      >
                        Remove
                      </button>
                    )}
                    {!entry.sizeError &&
                      entry.status !== "pending" &&
                      entry.status !== "done" &&
                      entry.status !== "error" && (
                        <span className="upload-entry-progress">
                          <span className="upload-spinner-inline" />
                          {phaseLabel(entry.status)}
                        </span>
                      )}
                    {entry.status === "done" && (
                      <span className="upload-entry-done">Done</span>
                    )}
                    {entry.status === "error" && (
                      <span className="upload-entry-error">
                        {entry.errorMessage ?? "Failed"}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {invalidCount > 0 && !running && (
            <p className="upload-warning-text">
              {invalidCount} file{invalidCount !== 1 ? "s" : ""} exceed the 10 MB limit and will
              be skipped.
            </p>
          )}
        </div>
        <div className="modal-footer">
          {!allDone && (
            <button
              type="button"
              className="copy-button"
              onClick={onClose}
              disabled={running}
            >
              Cancel
            </button>
          )}
          {!running && (
            <button
              type="button"
              className="button"
              disabled={validCount === 0}
              onClick={() => void startUploads()}
            >
              {validCount > 1 ? `Upload ${validCount} files` : "Upload"}
            </button>
          )}
          {allDone && (
            <button type="button" className="button" onClick={onClose}>
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function phaseLabel(status: FileStatus): string {
  switch (status) {
    case "hashing":
      return "Verifying…";
    case "creating":
      return "Preparing…";
    case "uploading":
      return "Uploading…";
    case "finalizing":
      return "Finalizing…";
    default:
      return "Working…";
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
