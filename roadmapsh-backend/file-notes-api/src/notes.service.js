const { randomUUID } = require("node:crypto");

const notes = [];

function listNotes() {
  return [...notes].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
}

function getNote(id) {
  return notes.find((note) => note.id === id) ?? null;
}

function createNote({ title, content }) {
  const now = new Date().toISOString();

  const note = {
    id: randomUUID(),
    title: title.trim(),
    content,
    createdAt: now,
    updatedAt: now,
  };

  notes.push(note);
  return note;
}

function updateNote(id, changes) {
  const note = getNote(id);
  if (!note) return null;

  if (changes.title !== undefined) {
    note.title = changes.title.trim();
  }

  if (changes.content !== undefined) {
    note.content = changes.content;
  }

  note.updatedAt = new Date().toISOString();
  return note;
}

function deleteNote(id) {
  const index = notes.findIndex((note) => note.id === id);
  if (index === -1) return false;

  notes.splice(index, 1);
  return true;
}

module.exports = {
  listNotes,
  getNote,
  createNote,
  updateNote,
  deleteNote,
};