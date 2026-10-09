// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@account-abstraction/contracts/interfaces/IPaymaster.sol";

/// Minimal EntryPoint stub — only implements the deposit/stake surface
/// that BasePaymaster calls. PlatformPaymaster overrides _validateEntryPointInterface
/// to a no-op, so passing this address to the constructor is safe in tests.
contract MockEntryPoint {
    mapping(address => uint256) public deposits;

    function depositTo(address account) external payable {
        deposits[account] += msg.value;
    }

    function withdrawTo(address payable withdrawAddress, uint256 amount) external {
        deposits[msg.sender] -= amount;
        (bool ok, ) = withdrawAddress.call{value: amount}("");
        require(ok, "withdraw failed");
    }

    function addStake(uint32) external payable {}
    function unlockStake() external {}
    function withdrawStake(address payable) external {}

    // Forwarders so tests can drive paymaster validation / postOp as the EntryPoint.
    function validatePaymasterUserOp(
        address paymaster,
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) external returns (bytes memory context, uint256 validationData) {
        return
            IPaymaster(paymaster).validatePaymasterUserOp(
                userOp,
                userOpHash,
                maxCost
            );
    }

    function callPostOp(
        address paymaster,
        IPaymaster.PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 actualUserOpFeePerGas
    ) external {
        IPaymaster(paymaster).postOp(
            mode,
            context,
            actualGasCost,
            actualUserOpFeePerGas
        );
    }

    receive() external payable {}
}
