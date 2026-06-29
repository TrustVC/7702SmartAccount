// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

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

    receive() external payable {}
}
