// Shared UserOp helpers for the gasless scripts.

import type { SmartAccountClient } from "permissionless";

// PlatformPaymaster._postOp writes up to two new storage slots (dailySpend, lastReset)
// on a user's first counted op. On Sepolia each new slot costs ~110k gas, so that
// postOp needs ~250k; with a lower limit it runs out of gas and the whole op reverts.
export const PAYMASTER_POST_OP_GAS_LIMIT = 300_000n;

type Call = { to: `0x${string}`; value?: bigint; data: `0x${string}` };

// Drop-in replacement for smartAccountClient.sendTransaction. sendTransaction resolves
// with the bundle tx hash even when the UserOp itself reverted on-chain (success=false),
// so a failed op looks like a success. This throws instead.
export async function sendSponsoredTransaction(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SmartAccountClient<any, any, any>,
  call: Call,
): Promise<`0x${string}`> {
  const hash = await client.sendUserOperation({ calls: [{ value: 0n, ...call }] });
  const { success, reason, receipt } = await client.waitForUserOperationReceipt({ hash });
  if (!success) {
    throw new Error(
      `UserOp ${hash} failed on-chain in tx ${receipt.transactionHash}` +
        (reason ? `: ${reason}` : " (check UserOperationRevertReason / PostOpRevertReason events)"),
    );
  }
  return receipt.transactionHash;
}
