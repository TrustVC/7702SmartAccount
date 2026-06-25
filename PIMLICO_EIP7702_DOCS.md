# EIP-7702 + Pimlico Integration — Developer Reference

## Table of Contents

1. [How Pimlico Works](#1-how-pimlico-works)
2. [API Key Setup](#2-api-key-setup)
3. [How PaymasterV2 Works](#3-how-paymasterv2-works)
4. [Registry Whitelisting](#4-registry-whitelisting)
5. [Function Reference](#5-function-reference)

---

## 1. How Pimlico Works

### EIP-7702 in one line

EIP-7702 lets a regular wallet (EOA) temporarily point to a smart contract
implementation. From that point on, calling the EOA executes smart contract
logic — without deploying a new contract address.

### The delegation (one-time, per EOA)

Before any sponsored transaction can be sent, the EOA must be delegated to
our implementation contract. This is a standard Ethereum type-4 transaction
paid by the operator wallet (`PRIVATE_KEY`). The end user only signs an
authorization — no ETH required on their side.

```
OWNER_PRIVATE_KEY  →  end user / holder — signs UserOps, zero ETH needed
PRIVATE_KEY        →  operator — pays for the one-time delegation tx only
```

After delegation, the EOA's on-chain code becomes:

```
0xef0100 + 0xECD2812e299c6aD5C3B1F11B91D8Cab83003E09D
```

### UserOperation flow (every transaction after delegation)

```
User signs UserOp  (OWNER_PRIVATE_KEY, raw ECDSA — no ETH)
       ↓
Pimlico Bundler receives the UserOp
       ↓
PaymasterV2 validates and agrees to sponsor gas
       ↓
EntryPoint (0x0000000071727De22E5E9d8BAf0edAc6f37da032) executes
       ↓
EOA's delegated implementation calls execute(to, value, data)
       ↓
Target contract function runs (e.g. nominate(), transferHolder())
```

The end user never touches ETH. Gas is deducted from the paymaster's
pre-funded deposit in the EntryPoint.

### Key contracts on Sepolia

| Role               | Address                                      |
| ------------------ | -------------------------------------------- |
| EntryPoint v0.7    | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |
| EOA Implementation | `0xECD2812e299c6aD5C3B1F11B91D8Cab83003E09D` |
| PaymasterV2        | `0xbdd57218ac281eE281A92051C699751738E687Be` |

---

## 2. API Key Setup

### Get a free Pimlico API key

1. Go to [dashboard.pimlico.io](https://dashboard.pimlico.io)
2. Create a project → copy the API key
3. Add to your `.env`:

```env
PIMLICO_API_KEY=your_key_here
OWNER_PRIVATE_KEY=0x...   # end user's private key
PRIVATE_KEY=0x...         # operator wallet (needs Sepolia ETH)
SEPOLIA_RPC_URL=https://...
REGISTRY_ADDRESS=0x145c2dae82b2717267e2da0c8525f4aed796a120
```

### How it is used in code

```typescript
const PIMLICO_URL =
  `https://api.pimlico.io/v2/11155111/rpc?apikey=${process.env.PIMLICO_API_KEY}`;

// Pimlico client — handles gas pricing and UserOp submission
const pimlicoClient = createPimlicoClient({
  transport:  http(PIMLICO_URL),
  entryPoint: { address: ENTRY_POINT, version: "0.7" },
});

// Smart account client — converts sendTransaction() into a UserOp
const smartAccountClient = createSmartAccountClient({
  account:          smartAccount,
  bundlerTransport: http(PIMLICO_URL),   // UserOps go to Pimlico
  client:           publicClient,        // eth_* calls go to your own node
  paymaster:        { ... },             // PaymasterV2 wired here
});
```

Pimlico is only used for two things:

- `eth_estimateUserOperationGas` — estimate gas for the UserOp
- `eth_sendUserOperation` — submit the UserOp to the mempool

All other calls (`eth_getCode`, `eth_getTransactionCount`, etc.) go through
your own `SEPOLIA_RPC_URL`, keeping costs low.

---

## 3. How PaymasterV2 Works

PaymasterV2 is a custom on-chain paymaster that sponsors gas for UserOps
targeting authorized contracts. No off-chain signing service is required —
all validation happens on-chain.

### Validation logic (`_validatePaymasterUserOp`)

Every UserOp goes through this check before gas is committed:

```
1. callData length ≥ 36 bytes                          (must contain at least a selector + address)
2. Selector == execute(address,uint256,bytes)           (only our implementation's execute)
3. Decoded `to` address ∈ authorizedRegistries         (target must be whitelisted)
4. dailySpend[sender] + maxCost ≤ dailyLimit           (per-user daily cap, 0 = no cap)
```

If any check fails, the UserOp is rejected — no gas is spent.

### Gas sponsorship flow

```
UserOp arrives at EntryPoint
       ↓
EntryPoint calls PaymasterV2.validatePaymasterUserOp()
       ↓  (all 4 checks pass)
EntryPoint executes the UserOp
       ↓
EntryPoint calls PaymasterV2.postOp(actualGasCost)
       ↓
PaymasterV2 records dailySpend[sender] += actualGasCost
       ↓
Gas deducted from PaymasterV2's deposit in EntryPoint
```

### Deployed configuration

```
Address:              0xbdd57218ac281eE281A92051C699751738E687Be
EntryPoint:           0x0000000071727De22E5E9d8BAf0edAc6f37da032
Authorized registry:  0x145c2dae82b2717267e2da0c8525f4aed796a120  (TR contract)
Daily limit:          0  (no cap)
```

---

## 4. Registry Whitelisting

PaymasterV2 uses a mapping to control which target contracts it will sponsor:

```solidity
mapping(address => bool) public authorizedRegistries;
```

Only UserOps whose `execute()` call targets a whitelisted registry are
sponsored. Calls to any other address are rejected with `"unauthorized target"`.

### Add a registry (owner only)

```solidity
function addRegistry(address registry) external onlyOwner
```

Script call:

```typescript
await walletClient.writeContract({
  address: "0xbdd57218ac281eE281A92051C699751738E687Be",
  abi: parseAbi(["function addRegistry(address) external"]),
  functionName: "addRegistry",
  args: ["0xYourNewRegistryAddress"],
});
```

### Remove a registry (owner only)

```solidity
function removeRegistry(address registry) external onlyOwner
```

### Check if a registry is authorized

```typescript
const ok = await publicClient.readContract({
  address: "0xbdd57218ac281eE281A92051C699751738E687Be",
  abi: parseAbi(["function authorizedRegistries(address) view returns (bool)"]),
  functionName: "authorizedRegistries",
  args: ["0x145c2dae82b2717267e2da0c8525f4aed796a120"],
});
// ok === true
```

> **Note:** The paymaster does NOT whitelist users. Any EOA delegated to the
> implementation can call any authorized registry — access control is enforced
> by the TR contract itself (e.g. `require(msg.sender == holder)`).

---

## 5. Function Reference

All scripts live in `scripts/trFunctions/`. Run any of them with:

```bash
npx hardhat run scripts/trFunctions/<script>.ts --network sepolia
```

---

### `nominate`

Nominates an address as the next beneficiary of the title record.

**Solidity signature**

```solidity
function nominate(address _nominee, bytes calldata _remark) external
```

**Script**

```bash
NOMINEE_ADDR=0xRecipientAddress \
REMARK="Nominating new beneficiary" \
  npx hardhat run scripts/trFunctions/nominate.ts --network sepolia
```

**Environment variables**
| Variable | Required | Description |
|---|---|---|
| `REGISTRY_ADDRESS` | Yes | Address of the TR contract |
| `NOMINEE_ADDR` | Yes | Address to nominate as beneficiary |
| `REMARK` | No | Human-readable note attached to the action (default: empty) |

**What happens on-chain**

```
UserOp.callData = execute(
  REGISTRY_ADDRESS,
  0,
  abi.encode(nominate(NOMINEE_ADDR, bytes(REMARK)))
)
```

The TR contract receives `msg.sender = OWNER_PRIVATE_KEY address` (the holder)
and records the nomination.

---

### `transferHolder`

Transfers the holder role to a new address immediately.

**Solidity signature**

```solidity
function transferHolder(address newHolder, bytes calldata _remark) external
```

**Script**

```bash
NEW_HOLDER_ADDR=0xNewHolderAddress \
REMARK="Transferring to new holder" \
  npx hardhat run scripts/trFunctions/transferHolder.ts --network sepolia
```

**Environment variables**
| Variable | Required | Description |
|---|---|---|
| `REGISTRY_ADDRESS` | Yes | Address of the TR contract |
| `NEW_HOLDER_ADDR` | Yes | Address of the incoming holder |
| `REMARK` | No | Human-readable note (default: empty) |

**What happens on-chain**

```
UserOp.callData = execute(
  REGISTRY_ADDRESS,
  0,
  abi.encode(transferHolder(NEW_HOLDER_ADDR, bytes(REMARK)))
)
```

The TR contract validates `msg.sender == currentHolder` and updates the holder
to `NEW_HOLDER_ADDR`. No ETH leaves the user's wallet at any point.

---

## Quick reference — all available scripts

| Script                         | Function                                  | Extra env vars needed             |
| ------------------------------ | ----------------------------------------- | --------------------------------- |
| `nominate.ts`                  | `nominate(address, bytes)`                | `NOMINEE_ADDR`                    |
| `transferBeneficiary.ts`       | `transferBeneficiary(address, bytes)`     | `NOMINEE_ADDR`                    |
| `transferHolder.ts`            | `transferHolder(address, bytes)`          | `NEW_HOLDER_ADDR`                 |
| `transferOwners.ts`            | `transferOwners(address, address, bytes)` | `NOMINEE_ADDR`, `NEW_HOLDER_ADDR` |
| `rejectTransferBeneficiary.ts` | `rejectTransferBeneficiary(bytes)`        | —                                 |
| `rejectTransferHolder.ts`      | `rejectTransferHolder(bytes)`             | —                                 |
| `rejectTransferOwners.ts`      | `rejectTransferOwners(bytes)`             | —                                 |
| `returnToIssuer.ts`            | `returnToIssuer(bytes)`                   | —                                 |
| `shred.ts`                     | `shred(bytes)`                            | —                                 |
