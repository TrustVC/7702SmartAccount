// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "./BasePaymaster.sol";
import "./interfaces/IEntryPoint.sol";

/**
 * A single-owner whitelist paymaster.
 * Owner adds/removes addresses that are allowed to have their gas sponsored.
 * No signature required — whitelist is checked purely on-chain.
 */
contract SimpleWhitelistPaymaster is BasePaymaster {
    using UserOperationLib for PackedUserOperation;
    mapping(address => bool) public whitelist;

    event AddedToWhitelist(address indexed account);
    event RemovedFromWhitelist(address indexed account);

    constructor(IEntryPoint _entryPoint) BasePaymaster(_entryPoint) {}

    // -------------------------------------------------------------------------
    // Owner whitelist management
    // -------------------------------------------------------------------------

    function addToWhitelist(address account) external onlyOwner {
        require(account != address(0), "Zero address");
        whitelist[account] = true;
        emit AddedToWhitelist(account);
    }

    function addBatchToWhitelist(
        address[] calldata accounts
    ) external onlyOwner {
        for (uint256 i; i < accounts.length; ++i) {
            require(accounts[i] != address(0), "Zero address");
            whitelist[accounts[i]] = true;
            emit AddedToWhitelist(accounts[i]);
        }
    }

    function removeFromWhitelist(address account) external onlyOwner {
        whitelist[account] = false;
        emit RemovedFromWhitelist(account);
    }

    // -------------------------------------------------------------------------
    // Deposit management
    // -------------------------------------------------------------------------

    function deposit() external payable onlyOwner {
        entryPoint.depositTo{value: msg.value}(address(this));
    }

    function withdrawTo(address payable to, uint256 amount) external onlyOwner {
        entryPoint.withdrawTo(to, amount);
    }

    // -------------------------------------------------------------------------
    // ERC-4337 paymaster logic
    // -------------------------------------------------------------------------

    function _validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 /*userOpHash*/,
        uint256 /*maxCost*/
    )
        internal
        view
        override
        returns (bytes memory context, uint256 validationData)
    {
        require(
            whitelist[userOp.getSender()],
            "SimpleWhitelistPaymaster: sender not whitelisted"
        );
        return ("", 0); // 0 = validation success, no expiry
    }

    // No context returned above so postOp is never called — default impl is fine.

    // Etherspot EP9 reports a different interfaceId than what the local IEntryPoint
    // computes — skip the interface check so deployment doesn't revert.
    function _validateEntryPointInterface(
        IEntryPoint
    ) internal pure override returns (bool) {}
}
