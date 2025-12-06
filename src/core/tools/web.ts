/**
 * Web Tools - WebSearch and WebFetch
 *
 * Uses duckduckgo-websearch package for search and content fetching
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { WebSearch as DuckDuckGoSearcher, WebFetcher as WebContentFetcher } from "duckduckgo-websearch";
import { log } from "../../logger.js";
import { simpleChatWithModel } from "../agent/models.js";
import { HumanMessage } from "@langchain/core/messages";
import { getDefaultModel } from "../config.js";

// Singleton instances
const searcher = new DuckDuckGoSearcher();
const fetcher = new WebContentFetcher();

// ============ WebSearch Tool ============

export const WebSearch = tool(
  async ({ query, maxResults = 10 }) => {
    const startTime = Date.now();
    log.toolStart("WebSearch", { query, maxResults });

    try {
      const results = await searcher.search(query, { maxResults });
      const durationMs = Date.now() - startTime;

      log.toolEnd("WebSearch", durationMs, results.length);

      if (results.length === 0) {
        return `No results found for query: "${query}"`;
      }

      let output = `Found ${results.length} search results:\n\n`;

      results.forEach((item: { title: string; snippet: string; link: string }, index: number) => {
        output += `${index + 1}. **${item.title}**\n`;
        output += `   ${item.snippet}\n`;
        output += `   Link: ${item.link}\n\n`;
      });

      output += `You can use WebFetch to get more details from any of these URLs.`;
      return output;
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      log.toolError("WebSearch", error.message);
      return `Web search failed: ${error.message}`;
    }
  },
  {
    name: "WebSearch",
    description: `Search the web using DuckDuckGo and return results.

Usage notes:
- Use when you need current information not in training data
- Effective for recent news, current events, product updates, or real-time data
- Search queries should be specific and well-targeted for best results
- Results include title, snippet, and link for each result
- Use WebFetch tool to get detailed content from specific URLs`,
    schema: z.object({
      query: z.string().describe("The search query"),
      maxResults: z.coerce.number().optional().default(10).describe("Maximum number of results (default: 10)"),
    }),
  }
);

// ============ WebFetch Tool ============

function normalizeUrl(url: string): string {
  // Auto-upgrade HTTP to HTTPS
  if (url.startsWith("http://")) {
    return url.replace("http://", "https://");
  }
  return url;
}

export const WebFetch = tool(
  async ({ url, prompt, maxLength = 8000 }) => {
    const startTime = Date.now();
    const normalizedUrl = normalizeUrl(url);
    log.toolStart("WebFetch", { url: normalizedUrl, prompt, maxLength });

    try {
      // Use WebContentFetcher to fetch and parse content
      const content = await fetcher.fetchAndParse(normalizedUrl, maxLength);

      // AI Analysis using the current model
      const systemPrompt = `You are analyzing web content based on a user's specific request.
The content has been extracted from a webpage.
Provide a focused response that directly addresses the user's prompt.`;

      const userPrompt = `Here is the content from ${normalizedUrl}:

${content}

User request: ${prompt}`;

      const model = getDefaultModel();
      const aiResponse = await simpleChatWithModel(
        [new HumanMessage(`${systemPrompt}\n\n${userPrompt}`)],
        model
      );

      const durationMs = Date.now() - startTime;
      log.toolEnd("WebFetch", durationMs, content.length);

      return aiResponse || "Unable to analyze content";
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      log.toolError("WebFetch", error.message);
      return `Error fetching URL ${normalizedUrl}: ${error.message}`;
    }
  },
  {
    name: "WebFetch",
    description: `Fetch content from a URL and analyze it with a prompt.

Usage notes:
- The URL must be a fully-formed valid URL (e.g., https://example.com)
- HTTP URLs will be automatically upgraded to HTTPS
- The prompt should describe what information you want to extract from the page
- This tool is read-only and does not modify any files
- Results may be summarized if the content is very large
- Built-in rate limiting (20 requests per minute)
- Use WebSearch first to find relevant URLs, then use WebFetch to get details`,
    schema: z.object({
      url: z.string().url().describe("The URL to fetch content from"),
      prompt: z.string().describe("The prompt to run on the fetched content"),
      maxLength: z.coerce.number().optional().default(8000).describe("Maximum content length (default: 8000)"),
    }),
  }
);
