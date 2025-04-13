import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse";
import express from "express";
import { z } from "zod";

const server = new McpServer({
  name: "My Super Cool Thursday MCP Demo Server",
  version: "1.0.0",
});

server.tool("getRandomDogImage", { breed: z.string() }, async ({ breed }) => {
  const response = await fetch(
    `https://dog.ceo/api/breed/${breed}/images/random`
  );
  const data = await response.json();

  return {
    content: [
      { type: "text", text: `Your dog image is here: ${data.message}` },
    ],
  };
});

const app = express();
let transport: SSEServerTransport | null = null;

app.get("/sse", (req, res) => {
  transport = new SSEServerTransport("/messages", res);
  server.connect(transport);
});

app.post("/messages", (req, res) => {
  if (transport) {
    transport.handlePostMessage(req, res);
  }
});

app.listen(3000);
console.log("MCP Server is running on http://localhost:3000/sse");
