export class CompanionClient {
  constructor(private readonly baseUrl: string) {}

  async postJson<T>(path: string, payload: unknown): Promise<T | null> {
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) return null;
      return await response.json() as T;
    } catch {
      return null;
    }
  }
}
