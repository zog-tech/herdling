export interface LineTransport {
  send(line: string): void;
  onLine(cb: (line: string) => void): () => void;
  onClose(cb: (reason: string) => void): () => void;
  close(): void;
}
