# EIP-7702 + MetaMask Architecture

## The Core Problem

MetaMask does **not** support `wallet_signAuthorization`.  
Ethers `signer.authorize()` also fails with MetaMask (`UNSUPPORTED_OPERATION`).  
The current `wallet_signAuthorization` wrapper in `pimlico.ts` is dead code that will throw at runtime.

---

## Architecture Options

### Option A — SimpleAccount (ERC-4337) `scripts/metamaskDelegation/`

**Status: Scripts written, CLI-testable today.**

```
EOA: 0xABC  →  SimpleAccount: 0xABC_SA  (different address)
```

| Step | Script |
|------|--------|
| Print SimpleAccount address | `printAddress.ts` |
| Whitelist for platform ops | `whitelistAccount.ts` |
| Deploy registry (gasless) | `deployRegistryGasless.ts` |
| Mint document (gasless) | `mintDocumentGasless.ts` |
| Transfer holder (gasless) | `transferHolder.ts` |
| Nominate (gasless) | `nominate.ts` |

**Paymaster interaction:**
- Path A (TitleEscrow calls): target = TitleEscrow → `authorizedTitleEscrows[target]` → **any sender accepted, no whitelist**
- Path B (platform ops): target = paymaster → `userWhitelist[0xABC_SA]` must be > 0

**Problem:** `holder` in TitleEscrow becomes `0xABC_SA`, not `0xABC`. User rejected this — holder must stay `0xABC` (EOA address).

---

### Option B — Rabby Wallet + EIP-7702 ✓ **Cleanest browser solution**

```
Rabby signs EIP-7702 natively → holder = 0xABC (EOA address preserved)
```

Rabby supports EIP-7702 delegation in-browser without any special API. No `wallet_signAuthorization` needed. The delegation signature is bundled into the transaction automatically.

**Problem:** Users must install Rabby. Not a MetaMask solution.

---

### Option C — `wallet_grantPermissions` (ERC-7715) + Session Key **Best UX for MetaMask**

**Status: Not yet implemented. MetaMask supports ERC-7715.**

```
ONE-TIME SETUP (user approves once in MetaMask popup):
  wallet_grantPermissions({
    signer: { type: "key", data: { id: 0xDEF } },  // session key from Privy/Dynamic
    permissions: [...],
    ...
  })
  → MetaMask: signs EIP-7702 auth (upgrades 0xABC to smart account)
             + signs delegation granting 0xDEF permission

FIRST UserOp (atomic):
  userOp.sender     = 0xABC           ← EOA address preserved ✓
  userOp.eip7702Auth = signed auth    ← upgrades 0xABC in same tx
  userOp.signature   = 0xDEF sig + delegation proof
  callData           = execute(TitleEscrow, 0, transferHolder(...))

SUBSEQUENT UserOps (silent, no popup):
  userOp.sender     = 0xABC
  userOp.signature  = 0xDEF sig + stored delegation proof
  callData          = execute(TitleEscrow, 0, ...)
```

#### Paymaster whitelist in this flow

| Operation | `userOp.sender` | Path | Whitelist? |
|-----------|-----------------|------|------------|
| TitleEscrow calls | `0xABC` | A (target = TitleEscrow) | **No** |
| deployRegistry / mintDocument | `0xABC` | B (target = paymaster) | **Yes — whitelist `0xABC`** |

`0xDEF` is only in the signature field — **never appears as `userOp.sender`**, never needs whitelisting.

#### Critical blocker

MetaMask's **Hybrid / Delegation Toolkit** uses **EntryPoint v0.7**.  
Our `PlatformPaymaster` uses **EntryPoint v0.8**.  
These are incompatible — the paymaster will reject v0.7 UserOps with AA33.

Resolution options:
1. Deploy a second `PlatformPaymaster` targeting v0.7 EntryPoint
2. Wait for MetaMask to upgrade Delegation Toolkit to v0.8
3. Use a different wallet that supports EIP-7702 + v0.8 (Privy embedded wallet, Dynamic, etc.)

---

## EntryPoint Versions Quick Reference

| Component | EntryPoint |
|-----------|-----------|
| `PlatformPaymaster` | **v0.8** `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` |
| `to7702SimpleSmartAccount` (permissionless) | **v0.8** |
| `toSimpleSmartAccount` (permissionless) | v0.7 default, **pass v0.8 explicitly** |
| MetaMask Delegation Toolkit | **v0.7** ← incompatible |
| v0.8 SimpleAccount factory (Sepolia) | `0x13E9ed32155810FDbd067D4522C492D6f68E5944` |

---

## Files To Fix (pimlico.ts / DelegationPanel.tsx)

- `7702Frontend/src/lib/pimlico.ts` — `wallet_signAuthorization` wrapper is broken dead code; remove it
- `7702Frontend/src/components/DelegationPanel.tsx` — shows "auto-delegation on first transaction" which is incorrect; update messaging to reflect actual wallet support status

---

## Decision Pending

- Pursue Option C (`wallet_grantPermissions`) → resolve EntryPoint v0.7/v0.8 mismatch first
- Or go with Rabby wallet for browser flow + CLI scripts for all other users
