import { EventEmitter } from "events";

class WebSocketService extends EventEmitter {
  private socket: WebSocket | null = null;
  private webSocketId: string = "";
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectionAttempts: number = 0;
  private maxReconnectionAttempts: number = Infinity;
  private reconnectionDelay: number = 1000;
  private reconnectionDelayMax: number = 5000;

  constructor() {
    super();
    this.connect();
  }

  public connect() {
    if (!this.socket || this.socket.readyState === WebSocket.CLOSED) {
      const websocketUrl = process.env.NEXT_PUBLIC_API_URL as string;

      try {
        this.socket = new WebSocket(websocketUrl);

        this.socket.onopen = () => {
          this.reconnectionAttempts = 0;
          this.webSocketId = this.generateId();
          this.emit("statusChange", true);
        };

        this.socket.onclose = () => {
          this.emit("statusChange", false);
          this.attemptReconnect();
        };

        this.socket.onerror = (error) => {
          console.error("WebSocket error:", error);
        };

        this.socket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            // Emit a general 'message' event with the entire data
            this.emit("message", data);

            // If the message includes an event property, emit that specific event
            if (data && data.event) {
              this.emit(data.event, data.data || data);
            }
          } catch (error) {
            console.error("Failed to parse WebSocket message:", error);
            this.emit("message", event.data);
          }
        };
      } catch (error) {
        console.error("Failed to connect to WebSocket:", error);
        this.attemptReconnect();
      }
    }
  }

  private attemptReconnect() {
    if (this.reconnectionAttempts < this.maxReconnectionAttempts) {
      this.reconnectionAttempts++;
      const delay = Math.min(
        this.reconnectionDelay * Math.pow(1.5, this.reconnectionAttempts - 1),
        this.reconnectionDelayMax
      );

      console.log(
        `Reconnect attempt #${this.reconnectionAttempts} in ${delay}ms`
      );

      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
      }

      this.reconnectTimer = setTimeout(() => {
        console.log("Attempting to reconnect...");
        this.connect();
      }, delay);
    } else {
      console.log("Failed to reconnect to WebSocket after maximum attempts");
      this.emit("reconnect_failed");
    }
  }

  public disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  public getSocket() {
    return this.socket;
  }

  public getWebSocketId() {
    return this.webSocketId;
  }

  public isConnected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public send(data: any) {
    if (this.socket && this.isConnected()) {
      this.socket.send(typeof data === "string" ? data : JSON.stringify(data));
      return true;
    }
    return false;
  }

  private generateId() {
    return "ws_" + Math.random().toString(36).substring(2, 15);
  }
}

const webSocketService = new WebSocketService();
export default webSocketService;
