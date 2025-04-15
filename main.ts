import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse";
import express from "express";
import { z } from "zod";

import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://groq.helicone.ai",
  defaultHeaders: {
    "Helicone-Auth": `Bearer ${process.env.HELICONE_API_KEY}`,
  },
});

// Retry + timeout fetch
async function fetchWithRetry(url: string, retries = 3, timeout = 5000): Promise<any> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`Fetch error: ${res.status} ${res.statusText}`);
      return await res.json();
    } catch (err) {
      clearTimeout(timer);
      if (attempt === retries) throw err;
      console.warn(`[Retry] Attempt ${attempt} failed. Retrying...`);
      await new Promise((r) => setTimeout(r, 1000)); // wait before retrying
    }
  }
  throw new Error("Failed after retries");
}

const server = new McpServer({
  name: "Weather Info MCP Server",
  version: "1.0.0",
});

server.tool("getCityTemperature", { city: z.string() }, async ({ city }) => {
  console.log(`[MCP] Tool called with city: ${city}`);

  try {
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`;
    const geoData = await fetchWithRetry(geoUrl);
    console.log(`[MCP] Geocode response:`, geoData);

    if (!geoData.results || geoData.results.length === 0) {
      throw new Error(`City "${city}" not found.`);
    }

    const { latitude: lat, longitude: lon } = geoData.results[0];
    
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
    const weatherData = await fetchWithRetry(weatherUrl);
    console.log(`[MCP] Weather response:`, weatherData);

    const temperature = weatherData.current_weather?.temperature;

    if (temperature === undefined) {
      throw new Error("Temperature data missing from weather response.");
    }

    // Get additional insights using Groq
    const completion = await groq.chat.completions.create({
      messages: [
        { 
          role: "user", 
          content: `The current temperature in ${city} is ${temperature}°C. 
          Please provide a brief, one-sentence insight about what this means for the weather in ${city}.`
        }
      ],
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      temperature: 0.7,
    });

    const insight = completion.choices[0].message.content || "";

    return {
      content: [
        { type: "text", text: `The current temperature in ${city} is ${temperature}°C.\n${insight}` },
      ],
    };
  } catch (err: any) {
    console.error(`[MCP] Error:`, err);
    return {
      content: [
        {
          type: "text",
          text: `Failed to fetch temperature for ${city}: ${err.message || err}`,
        },
      ],
    };
  }
});

server.tool("testGroq", { message: z.string().optional() }, async ({ message }) => {
  try {
    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: message || "Say hello!" }],
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      temperature: 0.7,
    });

    const response = completion.choices[0].message.content || "No response";
    return {
      content: [
        { type: "text", text: response },
      ],
    };
  } catch (err: any) {
    console.error("[MCP] Groq API error:", err);
    return {
      content: [
        { type: "text", text: `Error: ${err.message}` },
      ],
    };
  }
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
console.log("MCP Server running at http://localhost:3000/sse");
