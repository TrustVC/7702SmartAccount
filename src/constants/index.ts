export const ChainId = {
  Sepolia: 11155111,
  Amoy: 80002,
} as const;

/** Deployed contract addresses indexed by chainId */
export const contractAddress = {
  PaymasterImplementation: {
    [ChainId.Sepolia]: "0x5ca5652025ca77d13323ed4887b4cbee6098dd8f",
    [ChainId.Amoy]: "0xf47d58D3adc642DaD23966698A7A60b8b34D72f8",
  },
  PlatformAccountFactory: {
    [ChainId.Sepolia]: "0x1fe801f6af6e9a6c76431db08b121a7de70bc895",
    [ChainId.Amoy]: "0x2762abf6fa22314ebcab41dd4666836038d29341",
  },
} as const;