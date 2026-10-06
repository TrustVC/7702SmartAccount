// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PlatformPaymaster} from "./PlatformPaymaster.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

contract PlatformAccountFactory is Ownable {
    address public tdocDeployer;
    address public paymasterImplementation;
    mapping(address => address) public attachedPaymaster;

    event PlatformOnboarded(
        address indexed platformAddress,
        address indexed paymaster
    );
    event TdocDeployerUpdated(address indexed newDeployer);
    event ImplementationUpdated(address indexed newImplementation);

    constructor(
        address _tdocDeployer,
        address _paymasterImplementation
    ) Ownable(msg.sender) {
        tdocDeployer = _tdocDeployer;
        paymasterImplementation = _paymasterImplementation;
    }

    function updateTdocDeployer(address _tdocDeployer) external onlyOwner {
        require(_tdocDeployer != address(0), "Zero address");
        tdocDeployer = _tdocDeployer;
        emit TdocDeployerUpdated(_tdocDeployer);
    }

    function updatePaymasterImplementation(address _impl) external onlyOwner {
        require(_impl != address(0), "Zero address");
        paymasterImplementation = _impl;
        emit ImplementationUpdated(_impl);
    }

    /// @notice Owner-only onboarding. Salt is mixed with `platformAddress` so a
    /// predicted address cannot be front-run for a different platform.
    function deployPlatformPaymaster(
        address platformAddress,
        uint256 dailyLimit,
        bytes32 salt
    ) external onlyOwner returns (address paymaster) {
        require(platformAddress != address(0), "Zero address");
        require(
            attachedPaymaster[platformAddress] == address(0),
            "Already onboarded"
        );

        bytes32 deploymentSalt = _deploymentSalt(platformAddress, salt);
        paymaster = Clones.cloneDeterministic(
            paymasterImplementation,
            deploymentSalt
        );
        PlatformPaymaster(payable(paymaster)).initialize(
            platformAddress,
            dailyLimit,
            tdocDeployer
        );
        attachedPaymaster[platformAddress] = paymaster;
        emit PlatformOnboarded(platformAddress, paymaster);
    }

    /// @notice Predict clone address for a platform + salt pair.
    function computePaymasterAddress(
        address platformAddress,
        bytes32 salt
    ) external view returns (address) {
        return
            Clones.predictDeterministicAddress(
                paymasterImplementation,
                _deploymentSalt(platformAddress, salt),
                address(this)
            );
    }

    function _deploymentSalt(
        address platformAddress,
        bytes32 salt
    ) private pure returns (bytes32) {
        return keccak256(abi.encode(platformAddress, salt));
    }
}
