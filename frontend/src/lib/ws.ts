type Handler = (data: Record<string, unknown>) => void;

class WSClient {
  private ws: WebSocket | null = null;
  private handlers: Map<string, Handler[]> = new Map();
  private url: string;
  private reconnectDelay = 3000;

  constructor(url: string) {
    this.url = url;
  }

  connect(room: string = "global") {
    this.ws = new WebSocket(`${this.url}/ws/${room}`);

    this.ws.onmessage = (e) => {
      try {
        const { event, data } = JSON.parse(e.data);
        this.handlers.get(event)?.forEach((fn) => fn(data));
      } catch {}
    };

    this.ws.onclose = () => {
      setTimeout(() => this.connect(room), this.reconnectDelay);
    };
  }

  on(event: string, handler: Handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event)!.push(handler);
  }

  off(event: string, handler: Handler) {
    const list = this.handlers.get(event) ?? [];
    this.handlers.set(event, list.filter((h) => h !== handler));
  }
}

const _apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? _apiUrl.replace(/^http/, "ws");
export const wsClient = new WSClient(WS_URL);
