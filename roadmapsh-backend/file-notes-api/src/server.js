const http = require("node:http");
const { sendJson } = require("./utils");

const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
  if (req.method === "GET" && url.pathname === "/health") {
    return sendJson(res, 200, { status: "ok" });
  }

  if (req.method === "GET" && url.pathname === "/api/v1/notes") {
    return sendJson(res, 200, { data: [] });
  }

  return sendJson(res, 404, {
    error: {
      code: "NOT_FOUND",
      message: "Route not found",
    },
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});