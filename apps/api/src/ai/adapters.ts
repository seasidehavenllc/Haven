import Anthropic from "@anthropic-ai/sdk";

/**
 * Provider adapters. Each adapter turns a provider-neutral request into a call to one
 * vendor and reports usage so cost can be computed. Credentials come from env vars named
 * by AiProvider.credentialEnvVar — they are never stored in the database or sent to clients.
 */
export interface ImageInput {
  mime: string;
  base64: string;
}

export interface StructuredRequest {
  model: string;
  system: string;
  prompt: string;
  images?: ImageInput[];
  /** JSON Schema the response must satisfy. */
  schema: Record<string, unknown>;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  model: string;
  system: string;
  messages: ChatTurn[];
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
}

export interface AdapterResult<T> {
  output: T;
  inputTokens: number;
  outputTokens: number;
}

export interface TextAdapter {
  id: string;
  structured<T = unknown>(apiKey: string, req: StructuredRequest): Promise<AdapterResult<T>>;
  chat(apiKey: string, req: ChatRequest): Promise<AdapterResult<string>>;
}

export class ProviderError extends Error {
  constructor(public provider: string, message: string, public retryable: boolean) {
    super(message);
  }
}

const anthropicClients = new Map<string, Anthropic>();
function anthropicClient(apiKey: string) {
  let c = anthropicClients.get(apiKey);
  if (!c) {
    c = new Anthropic({ apiKey, maxRetries: 1, timeout: 120_000 });
    anthropicClients.set(apiKey, c);
  }
  return c;
}

function wrapAnthropicError(e: unknown): never {
  if (e instanceof Anthropic.RateLimitError) throw new ProviderError("anthropic", "rate limited", true);
  if (e instanceof Anthropic.InternalServerError) throw new ProviderError("anthropic", e.message, true);
  if (e instanceof Anthropic.APIConnectionError) throw new ProviderError("anthropic", "connection error", true);
  if (e instanceof Anthropic.APIError) throw new ProviderError("anthropic", `${e.status}: ${e.message}`, false);
  throw e;
}

export const anthropicAdapter: TextAdapter = {
  id: "anthropic",
  async structured<T>(apiKey: string, req: StructuredRequest) {
    const content: Anthropic.ContentBlockParam[] = [
      ...(req.images ?? []).map(
        (img): Anthropic.ContentBlockParam => ({
          type: "image",
          source: { type: "base64", media_type: img.mime as "image/jpeg", data: img.base64 },
        }),
      ),
      { type: "text", text: req.prompt },
    ];
    try {
      const res = await anthropicClient(apiKey).messages.create({
        model: req.model,
        max_tokens: req.maxTokens ?? 8000,
        system: req.system,
        messages: [{ role: "user", content }],
        output_config: { effort: req.effort ?? "low", format: { type: "json_schema", schema: req.schema } },
      } as Anthropic.MessageCreateParamsNonStreaming);
      if (res.stop_reason === "refusal") throw new ProviderError("anthropic", "request declined by model safety system", false);
      if (res.stop_reason === "max_tokens") throw new ProviderError("anthropic", "response truncated (max_tokens)", true);
      const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      return { output: JSON.parse(text) as T, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      if (e instanceof SyntaxError) throw new ProviderError("anthropic", "invalid JSON from model", true);
      wrapAnthropicError(e);
    }
  },
  async chat(apiKey: string, req: ChatRequest) {
    try {
      const res = await anthropicClient(apiKey).messages.create({
        model: req.model,
        max_tokens: req.maxTokens ?? 4000,
        system: req.system,
        messages: req.messages,
        output_config: { effort: req.effort ?? "low" },
      } as Anthropic.MessageCreateParamsNonStreaming);
      if (res.stop_reason === "refusal") throw new ProviderError("anthropic", "request declined by model safety system", false);
      const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      return { output: text, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      wrapAnthropicError(e);
    }
  },
};

/** OpenAI Chat Completions adapter (raw HTTPS; models/prices are configured by admins). */
export const openaiAdapter: TextAdapter = {
  id: "openai",
  async structured<T>(apiKey: string, req: StructuredRequest) {
    const content = [
      { type: "text", text: req.prompt },
      ...(req.images ?? []).map((i) => ({ type: "image_url", image_url: { url: `data:${i.mime};base64,${i.base64}` } })),
    ];
    const json = await openaiCall(apiKey, {
      model: req.model,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content },
      ],
      response_format: { type: "json_schema", json_schema: { name: "result", schema: req.schema, strict: false } },
    });
    try {
      return {
        output: JSON.parse(json.choices[0].message.content) as T,
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
      };
    } catch {
      throw new ProviderError("openai", "invalid JSON from model", true);
    }
  },
  async chat(apiKey: string, req: ChatRequest) {
    const json = await openaiCall(apiKey, {
      model: req.model,
      messages: [{ role: "system", content: req.system }, ...req.messages],
    });
    return {
      output: json.choices[0].message.content as string,
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0,
    };
  },
};

async function openaiCall(apiKey: string, body: unknown): Promise<any> {
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new ProviderError("openai", "connection error", true);
  }
  if (!res.ok) throw new ProviderError("openai", `${res.status}: ${(await res.text()).slice(0, 300)}`, res.status === 429 || res.status >= 500);
  return res.json();
}

export const textAdapters: Record<string, TextAdapter> = {
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
};

// Voice, transcription and avatar adapters live in ./voice.ts.
