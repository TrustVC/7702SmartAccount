export const ENTRY_POINT_ABI = [
  {
    type: "function",
    name: "getNonce",
    inputs: [
      { name: "sender", type: "address" },
      { name: "key", type: "uint192" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

export const IMPL_ABI = [
  {
    type: "function",
    name: "execute",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ name: "", type: "bytes" }],
    stateMutability: "payable",
  },
] as const;

export const STORAGE_ABI = [
  {
    type: "function",
    name: "create",
    inputs: [{ name: "_data", type: "string" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "update",
    inputs: [
      { name: "_id", type: "uint256" },
      { name: "_newData", type: "string" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "remove",
    inputs: [{ name: "_id", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "exists",
    inputs: [{ name: "_id", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getItemCount",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "ItemCreated",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "data", type: "string", indexed: false },
      { name: "timestamp", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ItemUpdated",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "data", type: "string", indexed: false },
      { name: "timestamp", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ItemDeleted",
    inputs: [{ name: "id", type: "uint256", indexed: true }],
  },
] as const;

export const TITLE_ESCROW_ABI = [
  {
    type: "function",
    name: "nominate",
    inputs: [
      { name: "_nominee", type: "address" },
      { name: "_remark", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "transferBeneficiary",
    inputs: [
      { name: "_nominee", type: "address" },
      { name: "_remark", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "transferHolder",
    inputs: [
      { name: "newHolder", type: "address" },
      { name: "_remark", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "transferOwners",
    inputs: [
      { name: "_nominee", type: "address" },
      { name: "newHolder", type: "address" },
      { name: "_remark", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "rejectTransferBeneficiary",
    inputs: [{ name: "_remark", type: "bytes" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "rejectTransferHolder",
    inputs: [{ name: "_remark", type: "bytes" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "rejectTransferOwners",
    inputs: [{ name: "_remark", type: "bytes" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "returnToIssuer",
    inputs: [{ name: "_remark", type: "bytes" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "shred",
    inputs: [{ name: "_remark", type: "bytes" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "beneficiary",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "holder",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "nominee",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isHoldingToken",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
] as const;
