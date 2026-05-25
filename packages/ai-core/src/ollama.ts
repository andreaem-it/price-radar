import type { OllamaGenerateRequest, OllamaGenerateResponse } from '@price-radar/types';

export class OllamaClient {
  constructor(
    private readonly baseUrl: string,
    private readonly defaultModel: string,
  ) {}

  async generate(
    prompt: string,
    options: Partial<OllamaGenerateRequest> = {},
  ): Promise<string> {
    const body: OllamaGenerateRequest = {
      model: options.model ?? this.defaultModel,
      prompt,
      stream: false,
      ...options,
    };

    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ollama request failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as OllamaGenerateResponse;
    return data.response.trim();
  }

  async generateJson<T>(prompt: string, model?: string): Promise<T> {
    const raw = await this.generate(prompt, {
      model,
      format: 'json',
      options: { temperature: 0.1, num_predict: 512 },
    });

    try {
      return JSON.parse(raw) as T;
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) {
        throw new Error('Ollama response is not valid JSON');
      }
      return JSON.parse(match[0]) as T;
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }
}

export function createOllamaClient(baseUrl: string, model: string): OllamaClient {
  return new OllamaClient(baseUrl, model);
}
