# TrustVC-7702 — Full Deployment Guide

## Architecture Overview

```text
PlatformAccountFactory
  └─ deploys ──► PlatformPaymaster (per platform, clone of the shared implementation)

User EOA (EIP-7702 delegated)
  └─ UserOp ──► execute(paymaster, deployRegistry(impl, name, symbol))
                  └─ TDocDeployer.deploy() ──► TradeTrustToken (registry)
                      ├─ DEFAULT_ADMIN_ROLE ──► calling EOA
                      └─ MINTER + RESTORER + ACCEPTER ──► paymaster

  └─ UserOp ──► execute(paymaster, mintDocument(registry, ...))
                  └─ registry.mint() ──► TitleEscrow (auto-authorized on paymaster)

  └─ UserOp ──► execute(titleEscrow, 0, transfer(...))   ← fully gasless
```

All scripts target EntryPoint **v0.8** (`0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108`).

---

## Prerequisites — .env Setup

Network-specific variables carry a `_<NETWORK>` suffix (`_SEPOLIA` or `_AMOY`) — the scripts
read e.g. `PAYMASTER_ADDRESS_SEPOLIA` when run against Sepolia. This guide uses Sepolia;
swap the suffix and `--network amoy` / `NETWORK=amoy` for Amoy.

```env
# Funded deployer wallet (pays gas for setup txs; becomes paymaster owner by default)
PRIVATE_KEY=0x...

# Whitelisted user EOA (signs UserOps — no ETH needed)
OWNER_PRIVATE_KEY=0x...

# RPC + bundler
SEPOLIA_RPC_URL=https://...
PIMLICO_API_KEY=...                   # free at dashboard.pimlico.io

# Known before deploying
TDOC_DEPLOYER_ADDRESS_SEPOLIA=        # canonical TDocDeployer on Sepolia
TDOC_IMPLEMENTATION_SEPOLIA=          # clonable TradeTrustToken impl (must be registered in TDocDeployer)

# Filled in as you deploy (add each after its step)
PAYMASTER_IMPLEMENTATION_SEPOLIA=     # Step 1a
FACTORY_ADDRESS_SEPOLIA=              # Step 1b
PAYMASTER_ADDRESS_SEPOLIA=            # Step 2
REGISTRY_ADDRESS_SEPOLIA=             # Step 7
TITLE_ESCROW_ADDRESS_SEPOLIA=         # Step 8

# Token details for each registry deployment
TOKEN_NAME=
TOKEN_SYMBOL=
```

To use the `cast` commands below, export `.env` into your shell first:

```bash
set -a; source .env; set +a
```

---

## Step 1 — Deploy PlatformPaymaster Implementation & Factory

The factory takes two constructor args — the TDocDeployer and the PlatformPaymaster
implementation it clones — so the implementation must be deployed first.

**1a. Deploy the PlatformPaymaster implementation** (once per chain):

```bash
npx hardhat run scripts/deployImplementation.ts --network sepolia
```

**Optional env override:**

```env
ENTRY_POINT=0x...    # EntryPoint v0.8 (default: 0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108)
```

**Save to .env:**

```env
PAYMASTER_IMPLEMENTATION_SEPOLIA=0x<printed address>
```

**1b. Deploy PlatformAccountFactory:**

Requires `TDOC_DEPLOYER_ADDRESS_SEPOLIA` and `PAYMASTER_IMPLEMENTATION_SEPOLIA` in `.env`.

```bash
npx hardhat run scripts/deployFactory.ts --network sepolia
```

**Save to .env:**

```env
FACTORY_ADDRESS_SEPOLIA=0x<printed address>
```

---

## Step 2 — Deploy PlatformPaymaster

Clones the implementation through the factory and initializes it with the owner, daily
limit and the factory's TDocDeployer.

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
PAYMASTER_ADDRESS_SEPOLIA=0x<printed address>
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

## Step 4 — Verify TdocDeployer on Paymaster

The factory passes its `tdocDeployer` into `initialize()` when cloning, so there is nothing
to set — just confirm it:

```bash
cast call $PAYMASTER_ADDRESS_SEPOLIA "tdocDeployer()(address)" --rpc-url $SEPOLIA_RPC_URL
# must return TDOC_DEPLOYER_ADDRESS_SEPOLIA, not 0x000...
```

> The paymaster's `tdocDeployer` is fixed at initialization. `updateTdocDeployer()` on the
> factory only affects paymasters deployed afterwards.

---

## Step 5 — Verify TDOC_IMPLEMENTATION is Registered in TDocDeployer

The TDocDeployer requires implementations to be whitelisted before cloning.

```bash
cast call $TDOC_DEPLOYER_ADDRESS_SEPOLIA \
  "implementations(address)(address)" $TDOC_IMPLEMENTATION_SEPOLIA \
  --rpc-url $SEPOLIA_RPC_URL
# must return a non-zero TitleEscrowFactory address
```

If it returns `0x000...`, the implementation is not registered.  
Only the TDocDeployer **owner** can register it:

```bash
cast send $TDOC_DEPLOYER_ADDRESS_SEPOLIA \
  "addImplementation(address,address)" $TDOC_IMPLEMENTATION_SEPOLIA $TITLE_ESCROW_FACTORY \
  --private-key $PRIVATE_KEY --rpc-url $SEPOLIA_RPC_URL
```

> If using the canonical TradeTrust TDocDeployer on Sepolia, you do not own it. Use only implementations already registered by the TradeTrust team.

---

## Step 6 — Whitelist User (assign deployment credits)

```bash
npx hardhat run scripts/whitelistUser.ts --network sepolia
```

**Optional env overrides:**

```env
WHITELIST_USER=0x...    # user EOA (default: address of OWNER_PRIVATE_KEY)
WHITELIST_CREDITS=3     # 0-3 (default: 3)
```

> PRIVATE_KEY must be the paymaster owner.

- Max credits per user: **3**
- Each `deployRegistry` call consumes 1 credit
- `mintDocument` does **not** consume credits — just checks whitelist > 0

**Verify:**

```bash
cast call $PAYMASTER_ADDRESS_SEPOLIA \
  "userWhitelist(address)(uint256)" $USER_EOA \
  --rpc-url $SEPOLIA_RPC_URL
```

---

## Gasless scripts (Steps 7–9)

- They pick the network from the `NETWORK` env var (`sepolia` | `amoy`, default `sepolia`), not from `--network`.
- On first run they delegate the `OWNER_PRIVATE_KEY` EOA via EIP-7702 to the permissionless
  Simple7702Account implementation; `PRIVATE_KEY` pays for that one-off type-4 tx. Later runs skip it.

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

The script prints the registry address from the `RegistryDeployed` event.

**Save to .env:**

```env
REGISTRY_ADDRESS_SEPOLIA=0x<printed registry>
```

If it prints `(check RegistryDeployed event on tx)` instead, look it up manually:

```bash
cast logs --from-block <txBlock> --to-block <txBlock> \
  --address $PAYMASTER_ADDRESS_SEPOLIA \
  "RegistryDeployed(address,address,uint256)" \
  --rpc-url $SEPOLIA_RPC_URL
```

---

## Step 8 — Mint Document Gaslessly

Requires `REGISTRY_ADDRESS_SEPOLIA` in `.env`.

```bash
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
4. Future calls to `execute(titleEscrow, 0, anyData)` from the escrow's current holder or beneficiary are sponsored (Path A)

The script prints the TitleEscrow address directly from the `TitleEscrowLinked` event.

**Save to .env:**

```env
TITLE_ESCROW_ADDRESS_SEPOLIA=0x<printed TitleEscrow>
```

---

## Step 9 — Gasless TitleEscrow Operations (transferHolder)

Once a TitleEscrow is in `authorizedTitleEscrows`, UserOps from its current holder or
beneficiary targeting it are sponsored via Path A.

```bash
NEW_HOLDER_ADDR=0x...         \
REMARK="optional note"        \
npx hardhat run scripts/trFunctions/transferHolder.ts --network sepolia
```

**Required .env for all `trFunctions/` scripts:**

```env
PIMLICO_API_KEY=...
OWNER_PRIVATE_KEY=0x...                # must be the escrow's current holder/beneficiary
SEPOLIA_RPC_URL=https://...
PAYMASTER_ADDRESS_SEPOLIA=0x...
TITLE_ESCROW_ADDRESS_SEPOLIA=0x...
PRIVATE_KEY=0x...                      # only needed if EIP-7702 delegation hasn't been done yet
```

Daily spend limit per user applies (if `DAILY_LIMIT_ETH` > 0). Inspect or change it with
`npx hardhat run scripts/dailyLimit.ts --network sepolia`.

---

## Diagnostic Commands

```bash
# Paymaster state
cast call $PAYMASTER_ADDRESS_SEPOLIA "tdocDeployer()(address)"                --rpc-url $SEPOLIA_RPC_URL
cast call $PAYMASTER_ADDRESS_SEPOLIA "userWhitelist(address)(uint256)" $EOA   --rpc-url $SEPOLIA_RPC_URL
cast call $PAYMASTER_ADDRESS_SEPOLIA "authorizedRegistries(address)(bool)" $REGISTRY_ADDRESS_SEPOLIA --rpc-url $SEPOLIA_RPC_URL
cast call $PAYMASTER_ADDRESS_SEPOLIA "dailyLimit()(uint256)"                  --rpc-url $SEPOLIA_RPC_URL

# EntryPoint v0.8 deposit & stake
cast call 0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108 \
  "getDepositInfo(address)(uint256,bool,uint112,uint32,uint48)" $PAYMASTER_ADDRESS_SEPOLIA \
  --rpc-url $SEPOLIA_RPC_URL

# Registry roles
MINTER_ROLE=$(cast keccak "MINTER_ROLE")
cast call $REGISTRY_ADDRESS_SEPOLIA "hasRole(bytes32,address)(bool)" $MINTER_ROLE $PAYMASTER_ADDRESS_SEPOLIA --rpc-url $SEPOLIA_RPC_URL
cast call $REGISTRY_ADDRESS_SEPOLIA "hasRole(bytes32,address)(bool)" 0x0000000000000000000000000000000000000000000000000000000000000000 $YOUR_EOA --rpc-url $SEPOLIA_RPC_URL
```

---

## Contract Addresses (Sepolia)

| Contract                         | Address                                                |
| -------------------------------- | ------------------------------------------------------ |
| EntryPoint v0.8                  | `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108`           |
| PlatformPaymaster implementation | _(set PAYMASTER_IMPLEMENTATION_SEPOLIA after Step 1a)_ |
| PlatformAccountFactory           | _(set FACTORY_ADDRESS_SEPOLIA after Step 1b)_          |
| PlatformPaymaster                | _(set PAYMASTER_ADDRESS_SEPOLIA after Step 2)_         |
