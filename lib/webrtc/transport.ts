export interface VoiceTransport {
  connect(url: string, token: string): Promise<void>;
  publishMicrophone(): Promise<void>;
  onLevel(cb: (level: number) => void): () => void;
  disconnect(): Promise<void>;
}
