function fileLabel(path) {
  return typeof path === "string" && path ? path : "this file";
}

function statusLabel(status) {
  return typeof status === "string" ? status.trim().toLowerCase() : "";
}

export function describeRevert(path, status) {
  const label = fileLabel(path);

  switch (statusLabel(status)) {
    case "added":
    case "new":
    case "untracked":
      return {
        action: "Delete file",
        pending: "Deleting…",
        title: `Delete new or untracked file ${label}`,
        confirmation: `Delete ${label}? This removes the file from the working tree and, if staged, from the index. It cannot be undone from this screen.`,
        success: `Deleted ${label}.`,
      };
    case "deleted":
      return {
        action: "Restore file",
        pending: "Restoring…",
        title: `Restore ${label} from the last commit`,
        confirmation: `Restore ${label}? This discards the deletion; an untracked file at the same path will be replaced. It cannot be undone from this screen.`,
        success: `Restored ${label}.`,
      };
    default:
      return {
        action: "Revert file",
        pending: "Reverting…",
        title: `Revert staged and unstaged changes in ${label}`,
        confirmation: `Revert ${label}? This discards its staged and unstaged changes and cannot be undone from this screen.`,
        success: `Reverted ${label}.`,
      };
  }
}
