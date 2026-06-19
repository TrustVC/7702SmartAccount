/// <reference types="vite/client" />

interface Window {
  ethereum: import("ethers").Eip1193Provider & {
    request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    on: (event: string, handler: (...args: unknown[]) => void) => void;
  };
}
