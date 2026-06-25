export const PAYMASTER_ADDRESS = (import.meta.env.VITE_PAYMASTER_ADDRESS ??
  "") as `0x${string}`;

export const TDOC_IMPLEMENTATION = (import.meta.env.VITE_TDOC_IMPLEMENTATION ??
  "") as `0x${string}`;

export const REGISTRY_ADDRESS = (import.meta.env.VITE_REGISTRY_ADDRESS ??
  "") as `0x${string}`;

export const TITLE_ESCROW_ADDRESS = (import.meta.env
  .VITE_TITLE_ESCROW_ADDRESS ?? "") as `0x${string}`;

export const FACTORY_ADDRESS = (import.meta.env.VITE_FACTORY_ADDRESS ??
  "") as `0x${string}`;

export const PIMLICO_API_KEY = import.meta.env.VITE_PIMLICO_API_KEY ?? "";

export const SEPOLIA_RPC_URL =
  import.meta.env.VITE_SEPOLIA_RPC_URL ?? "https://rpc.sepolia.org";

export const PIMLICO_URL = `https://api.pimlico.io/v2/11155111/rpc?apikey=${PIMLICO_API_KEY}`;

export const SEPOLIA_CHAIN_ID = 11155111;
