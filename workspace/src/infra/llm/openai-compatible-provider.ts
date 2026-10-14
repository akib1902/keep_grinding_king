/**
 * OpenAI-compatible provider adapter.
 *
 * Talks the `/chat/completions` tool-calling shape, which is implemented by
 * OpenAI, Azure OpenAI, the OpenLLM gateway, vLLM, Ollama and most hosted
 * gateways — so the deployment can switch vendor with configuration only.
 *
 * Responsibilities kept here, and only here:
 *  * normalise provider responses into internal `LlmTurnResult` types,
 *  * convert every provider-specific failure into a controlled application error
 *    with a retry classification (SRS §4.4),
 *  * honour the AbortSignal so the runtime's 30-second deadline actually cancels
 *    an in-flight request,
 *  * bound provider-level retries by configuration.
 *
 * Credentials stay server-side; nothing about the key is ever logged.
 */
import { AppError, ErrorCode } from '../../domain/errors.js';
import type { LlmMessage, LlmProviderPort, LlmTurnRequest, LlmTurnResult, LlmToolCall } from '../../app/ports.js';

export interface OpenAiCompatibleOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Per-request timeout, kept below the agent deadline so we surface our own error. */
  requestTimeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
}

interface ChatCompletionMessage {
  role: string;
  content?: string | null;
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

interface ChatCompletionResponse {
  model?: string;
  choices?: Array<{ message?: ChatCompletionMessage; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; type?: string; code?: string };
}

export class OpenAiCompatibleProvider implements LlmProviderPort {
  readonly name = 'openai-compatible';
  readonly model: string;
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #requestTimeoutMs: number;
  readonly #maxRetries: number;
  readonly #fetch: typeof fetch;

  constructor(options: OpenAiCompatibleOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.#apiKey = options.apiKey;
    this.model = options.model;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 25_000;
    this.#maxRetries = options.maxRetries ?? 2;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async runTurn(request: LlmTurnRequest): Promise<LlmTurnResult> {
    const attempts = Math.max(1, Math.min(request.maxRetries + 1, this.#maxRetries + 1));
    let lastError: AppError | null = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (request.signal.aborted) throw this.#abortError();
      try {
        return await this.#requestOnce(request);
      } catch (error) {
        const appError = error instanceof AppError ? error : this.#mapError(error);
        lastError = appError;
        // Only retryable categories are retried; a schema or auth failure is not.
        if (!appError.retryable || attempt === attempts) throw appError;
        await this.#backoff(attempt, request.signal);
      }
    }

    throw lastError ?? this.#mapError(new Error('Provider call failed.'));
  }

  async #requestOnce(request: LlmTurnRequest): Promise<LlmTurnResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#requestTimeoutMs);
    const onAbort = (): void => controller.abort();
    request.signal.addEventListener('abort', onAbort, { once: true });

    try {
      const response = await this.#fetch(`${this.#baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.#apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: toProviderMessages(request.system, request.messages),
          tools: request.tools.map((tool) => ({
            type: 'function',
            function: { name: tool.name, description: tool.description, parameters: tool.parameters },
          })),
          tool_choice: 'auto',
          temperature: 0,
          max_tokens: request.maxOutputTokens,
        }),
        signal: controller.signal,
      });

      const body = (await response.json().catch(() => ({}))) as ChatCompletionResponse;

      if (!response.ok) {
        const message = body.error?.message ?? `Provider responded with HTTP ${response.status}.`;
        const retryable = response.status >= 500 || response.status === 429;
        throw new AppError({
          code: ErrorCode.PROVIDER_ERROR,
          message: `Model provider error: ${message}`,
          category: 'PROVIDER',
          httpStatus: 503,
          retryable,
          details: { providerStatus: response.status },
        });
      }

      const message = body.choices?.[0]?.message;
      if (!message) {
        throw new AppError({
          code: ErrorCode.MODEL_OUTPUT_INVALID,
          message: 'Model provider returned no message.',
          category: 'PROVIDER',
          httpStatus: 502,
          retryable: true,
        });
      }

      const toolCalls: LlmToolCall[] = (message.tool_calls ?? []).map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.function.name,
        // Arguments stay raw here: the registry validates them before execution.
        arguments: safeParseJson(toolCall.function.arguments),
      }));

      const text = typeof message.content === 'string' && message.content.length > 0 ? message.content : null;

      return {
        assistantMessage: {
          role: 'assistant',
          content: text ?? '',
          toolCalls,
        },
        toolCalls,
        text,
        usage: {
          promptTokens: body.usage?.prompt_tokens ?? 0,
          completionTokens: body.usage?.completion_tokens ?? 0,
        },
        model: body.model ?? this.model,
      };
    } catch (error) {
      if (controller.signal.aborted) {
        throw request.signal.aborted ? this.#abortError() : this.#timeoutError();
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      request.signal.removeEventListener('abort', onAbort);
    }
  }

  #mapError(error: unknown): AppError {
    if (error instanceof AppError) return error;
    const message = error instanceof Error ? error.message : 'Unknown provider transport failure.';
    return new AppError({
      code: ErrorCode.PROVIDER_ERROR,
      message: `Model provider transport failure: ${message}`,
      category: 'PROVIDER',
      httpStatus: 503,
      retryable: true,
      cause: error,
    });
  }

  #abortError(): AppError {
    return new AppError({
      code: ErrorCode.EXECUTION_DEADLINE_EXCEEDED,
      message: 'Model provider call was cancelled because the execution deadline elapsed.',
      category: 'TIMEOUT',
      httpStatus: 504,
      retryable: true,
    });
  }

  #timeoutError(): AppError {
    return new AppError({
      code: ErrorCode.PROVIDER_TIMEOUT,
      message: `Model provider did not respond within ${this.#requestTimeoutMs}ms.`,
      category: 'TIMEOUT',
      httpStatus: 504,
      retryable: true,
    });
  }

  async #backoff(attempt: number, signal: AbortSignal): Promise<void> {
    const delay = Math.min(4_000, 250 * 2 ** (attempt - 1));
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, delay);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
}

function toProviderMessages(system: string, messages: readonly LlmMessage[]): ChatCompletionMessage[] {
  const out: ChatCompletionMessage[] = [{ role: 'system', content: system }];
  for (const message of messages) {
    if (message.role === 'tool') {
      out.push({ role: 'tool', content: message.content, tool_call_id: message.toolCallId ?? '' });
      continue;
    }
    if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
      out.push({
        role: 'assistant',
        content: message.content,
        tool_calls: message.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: 'function',
          function: { name: toolCall.name, arguments: JSON.stringify(toolCall.arguments ?? {}) },
        })),
      });
      continue;
    }
    out.push({ role: message.role, content: message.content });
  }
  return out;
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    // Malformed JSON arguments are passed through as a raw string so the registry
    // rejects them with TOOL_ARGUMENT_INVALID instead of crashing the attempt.
    return { __invalidJson: value };
  }
}
