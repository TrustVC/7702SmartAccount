# TrustVC-7702 — Full Deployment Guide

## Architecture Overview

```
PlatformAccountFactory
  └─ deploys ──► PlatformPaymaster (per platform)

User EOA (EIP-7702 delegated)
  └─ UserOp ──► execute(paymaster, deployRegistry(impl, name, symbol))
                  └─ TDocDeployer.deploy() ──► TradeTrustToken (registry)
                      ├─ DEFAULT_ADMIN_ROLE ──► calling EOA
                      └─ MINTER + RESTORER + ACCEPTER ──► paymaster

  └─ UserOp ──► execute(paymaster, mintDocument(registry, ...))
                  └─ registry.mint() ──► TitleEscrow (auto-authorized on paymaster)

  └─ UserOp ──► execute(titleEscrow, 0, transfer(...))   ← fully gasless
```

---

## Prerequisites — .env Setup

```env
# Funded deployer wallet (pays gas for setup txs)
PRIVATE_KEY=0x...

# Whitelisted user EOA (signs UserOps — no ETH needed)
OWNER_PRIVATE_KEY=0x...

# RPC + bundler
SEPOLIA_RPC_URL=https://...
PIMLICO_API_KEY=...               # free at dashboard.pimlico.io

# Filled in as you deploy (add each after its step)
FACTORY_ADDRESS=
PAYMASTER_ADDRESS=
EIP7702_IMPL_ADDRESS=             # EIP7702Implementation from factory
TDOC_IMPLEMENTATION=              # clonable TradeTrustToken impl (must be registered in TDocDeployer)
TDOC_DEPLOYER_ADDRESS=            # canonical TDocDeployer on Sepolia

# Token details for each registry deployment
TOKEN_NAME=
TOKEN_SYMBOL=
```

---

## Step 1 — Deploy Factory

```bash
npx hardhat ignition deploy ignition/modules/Factory.ts --network sepolia
```

- First time: deploys fresh.
- If contract changed since last deploy: add `--reset` to force redeploy.

**Save to .env:**

```env
FACTORY_ADDRESS=0x<printed address>
```

---

## Step 2 — Deploy PlatformPaymaster

```bash
npx hardhat run scripts/deployPlatformPaymaster.ts --network sepolia
```

**Optional env overrides:**

```env
PLATFORM_ADDRESS=0x...    # paymaster owner EOA (defaults to PRIVATE_KEY wallet)
DAILY_LIMIT_ETH=0         # per-user daily gas cap in ETH (0 = unlimited)
DEPLOY_SALT=0x...         # hex bytes32 for CREATE2 (auto-random if unset)
```

**Save to .env:**

```env
PAYMASTER_ADDRESS=0x<printed address>
```

---

## Step 3 — Stake & Fund Paymaster on EntryPoint

```bash
npx hardhat run scripts/stakePlatformPaymaster.ts --network sepolia
```

**Optional env overrides:**

```env
STAKE_AMOUNT_ETH=0.01      # locked bond (default: 0.01)
DEPOSIT_AMOUNT_ETH=0.05    # gas pool for sponsoring UserOps (default: 0.05)
UNSTAKE_DELAY_SEC=86400    # lock period in seconds (default: 1 day)
```

> PRIVATE_KEY must be the paymaster owner (same as PLATFORM_ADDRESS).

---

## Step 4 — Set TdocDeployer on Paymaster

```bash
cast send $PAYMASTER_ADDRESS \
  "setTdocDeployer(address)" $TDOC_DEPLOYER_ADDRESS \
  --private-key $PRIVATE_KEY --rpc-url $SEPOLIA_RPC_URL
```

**Verify:**

```bash
cast call $PAYMASTER_ADDRESS "tdocDeployer()(address)" --rpc-url $SEPOLIA_RPC_URL
# must return TDOC_DEPLOYER_ADDRESS, not 0x000...
```

---

## Step 5 — Verify TDOC_IMPLEMENTATION is Registered in TDocDeployer

The TDocDeployer requires implementations to be whitelisted before cloning.

```bash
cast call $TDOC_DEPLOYER_ADDRESS \
  "implementations(address)(address)" $TDOC_IMPLEMENTATION \
  --rpc-url $SEPOLIA_RPC_URL
# must return a non-zero TitleEscrowFactory address
```

If it returns `0x000...`, the implementation is not registered.  
Only the TDocDeployer **owner** can register it:

```bash
cast send $TDOC_DEPLOYER_ADDRESS \
  "addImplementation(address,address)" $TDOC_IMPLEMENTATION $TITLE_ESCROW_FACTORY \
  --private-key $PRIVATE_KEY --rpc-url $SEPOLIA_RPC_URL
```

> If using the canonical TradeTrust TDocDeployer on Sepolia, you do not own it. Use only implementations already registered by the TradeTrust team.

---

## Step 6 — Whitelist User (assign deployment credits)

```bash
cast send $PAYMASTER_ADDRESS \
  "setUserWhitelist(address,uint256)" $USER_EOA 3 \
  --private-key $PRIVATE_KEY --rpc-url $SEPOLIA_RPC_URL
```

- Max credits per user: **3**
- Each `deployRegistry` call consumes 1 credit
- `mintDocument` does **not** consume credits — just checks whitelist > 0

**Verify:**

```bash
cast call $PAYMASTER_ADDRESS \
  "userWhitelist(address)(uint256)" $USER_EOA \
  --rpc-url $SEPOLIA_RPC_URL
```

---

## Step 7 — Deploy Registry Gaslessly (UserOp via Pimlico)

```bash
TOKEN_NAME="My Document Token" \
TOKEN_SYMBOL="MDT"             \
npx hardhat run scripts/deployRegistryGasless.ts --network sepolia
```

**What happens on-chain:**

1. UserOp: `EOA.execute(paymaster, 0, deployRegistry(tdocImpl, name, symbol))`
2. Paymaster deploys clone via TDocDeployer
3. Paymaster grants `DEFAULT_ADMIN_ROLE` → calling EOA
4. Paymaster renounces `DEFAULT_ADMIN_ROLE` (keeps MINTER + RESTORER + ACCEPTER)
5. Registry added to `authorizedRegistries` on paymaster

**Find the deployed registry address** from the `RegistryDeployed` event on the printed tx hash:

```bash
cast logs --from-block <txBlock> --to-block <txBlock> \
  --address $PAYMASTER_ADDRESS \
  "RegistryDeployed(address,address,uint256)" \
  --rpc-url $SEPOLIA_RPC_URL
```

**Save:**

```env
REGISTRY_ADDRESS=0x<deployed registry>
```

---

## Step 8 — Mint Document Gaslessly

```bash
REGISTRY_ADDRESS=0x...        \
BENEFICIARY_ADDRESS=0x...     \
HOLDER_ADDRESS=0x...          \
TOKEN_ID=0x<keccak256-doc-hash-as-uint256> \
REMARK="optional note"        \
npx hardhat run scripts/mintDocumentGasless.ts --network sepolia
```

> `REMARK` accepts plain text or hex (`0x...`) — both work.  
> `TOKEN_ID` is a uint256, typically the keccak256 hash of your document.

**What happens on-chain:**

1. UserOp: `EOA.execute(paymaster, 0, mintDocument(registry, beneficiary, holder, tokenId, remark))`
2. Paymaster calls `registry.mint(...)` — paymaster holds `MINTER_ROLE`
3. Returned TitleEscrow is stored in `authorizedTitleEscrows` on paymaster
4. Future calls to `execute(titleEscrow, 0, anyData)` are auto-sponsored (Path A)

The script prints the TitleEscrow address directly from the `TitleEscrowLinked` event.

**Save:**

```env
TITLE_ESCROW_ADDRESS=0x<printed TitleEscrow>
```

---

## Step 9 — Gasless TitleEscrow Operations (transferHolder)

Once a TitleEscrow is in `authorizedTitleEscrows`, any UserOp targeting it is sponsored via Path A.

```bash
TITLE_ESCROW_ADDRESS=0x...    \
NEW_HOLDER_ADDR=0x...         \
REMARK="optional note"        \
npx hardhat run scripts/trFunctions/transferHolder.ts --network sepolia
```

**Required .env for all `trFunctions/` scripts:**

```env
PIMLICO_API_KEY=...
OWNER_PRIVATE_KEY=0x...
SEPOLIA_RPC_URL=https://...
EIP7702_IMPL_ADDRESS=0x...
PAYMASTER_ADDRESS=0x...
PRIVATE_KEY=0x...              # only needed if EIP-7702 delegation hasn't been done yet
```

Daily spend limit per user applies (if `DAILY_LIMIT_ETH` > 0).

---

## Diagnostic Commands

```bash
# Paymaster state
cast call $PAYMASTER_ADDRESS "tdocDeployer()(address)"              --rpc-url $SEPOLIA_RPC_URL
cast call $PAYMASTER_ADDRESS "userWhitelist(address)(uint256)" $EOA --rpc-url $SEPOLIA_RPC_URL
cast call $PAYMASTER_ADDRESS "authorizedRegistries(address)(bool)" $REGISTRY --rpc-url $SEPOLIA_RPC_URL
cast call $PAYMASTER_ADDRESS "dailyLimit()(uint256)"               --rpc-url $SEPOLIA_RPC_URL

# EntryPoint deposit & stake
cast call 0x0000000071727De22E5E9d8BAf0edAc6f37da032 \
  "getDepositInfo(address)(uint256,bool,uint112,uint32,uint48)" $PAYMASTER_ADDRESS \
  --rpc-url $SEPOLIA_RPC_URL

# Registry roles
MINTER_ROLE=$(cast keccak "MINTER_ROLE")
cast call $REGISTRY_ADDRESS "hasRole(bytes32,address)(bool)" $MINTER_ROLE $PAYMASTER_ADDRESS --rpc-url $SEPOLIA_RPC_URL
cast call $REGISTRY_ADDRESS "hasRole(bytes32,address)(bool)" 0x0000000000000000000000000000000000000000000000000000000000000000 $YOUR_EOA --rpc-url $SEPOLIA_RPC_URL
```

---

## Contract Addresses (Sepolia)

| Contract                  | Address                                      |
| ------------------------- | -------------------------------------------- |
| EntryPoint v0.7 (Pimlico) | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |
| PlatformAccountFactory    | _(set FACTORY_ADDRESS after Step 1)_         |
| PlatformPaymaster         | _(set PAYMASTER_ADDRESS after Step 2)_       |
