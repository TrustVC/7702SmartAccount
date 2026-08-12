export const ChainId = {
  Sepolia: 11155111,
} as const;

/** Deployed contract addresses indexed by chainId */
export const contractAddress = {
  PlatformAccountFactory: {
    [ChainId.Sepolia]: "0x5dcDf7fA6Ab8323F67FD66E89b6CeD4564f9F4Ff",
  },
} as const;
