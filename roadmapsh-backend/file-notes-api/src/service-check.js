const service = require("./notes.service");

const note = service.createNote({
  title: "Learn HTTP",
  content: "Understand requests and responses",
});

console.log("Created:", note);
console.log("Found:", service.getNote(note.id));
console.log("List:", service.listNotes());

service.updateNote(note.id, { title: "Learn Node.js" });
console.log("Updated:", service.getNote(note.id));

service.deleteNote(note.id);
console.log("After delete:", service.getNote(note.id));