// Editor session — dirty flag + undo/redo stack (ciclo A).
// Pure helper; no Firebase dependency.

function deepClone(list) {
  try {
    return JSON.parse(JSON.stringify(list || []));
  } catch (_) {
    return (list || []).map((c) => ({ ...c }));
  }
}

function fingerprint(list) {
  return JSON.stringify(list || []);
}

export function createEditorSession() {
  let dirty = false;
  let baseline = '[]';
  const undoStack = [];
  const redoStack = [];
  const MAX = 50;

  return {
    reset(cells) {
      baseline = fingerprint(cells);
      dirty = false;
      undoStack.length = 0;
      redoStack.length = 0;
    },
    markDirty() {
      dirty = true;
    },
    markClean(cells) {
      baseline = fingerprint(cells);
      dirty = false;
      undoStack.length = 0;
      redoStack.length = 0;
    },
    isDirty() {
      return dirty;
    },
    syncDirtyFrom(cells) {
      dirty = fingerprint(cells) !== baseline;
      return dirty;
    },
    pushUndo(beforeCells) {
      undoStack.push(deepClone(beforeCells));
      if (undoStack.length > MAX) undoStack.shift();
      redoStack.length = 0;
      dirty = true;
    },
    undo(currentCells) {
      if (!undoStack.length) return null;
      redoStack.push(deepClone(currentCells));
      const prev = undoStack.pop();
      dirty = fingerprint(prev) !== baseline;
      return prev;
    },
    redo(currentCells) {
      if (!redoStack.length) return null;
      undoStack.push(deepClone(currentCells));
      const next = redoStack.pop();
      dirty = fingerprint(next) !== baseline;
      return next;
    },
    canUndo() {
      return undoStack.length > 0;
    },
    canRedo() {
      return redoStack.length > 0;
    }
  };
}
