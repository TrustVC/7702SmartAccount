// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PlatformPaymaster} from "./PlatformPaymaster.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

/**
 * @title PlatformAccountFactory
 * @notice Deploys PlatformPaymaster clones. Public ABI matches `dev`
 * (`deployPlatformPaymaster`, `computePaymasterAddress(bytes32)`, …).
 * Onboarding is owner-gated; platform→paymaster binding is tracked privately.
 */
contract PlatformAccountFactory is Ownable {
    address public tdocDeployer;
    address public paymasterImplementation;
    /// @dev Not exposed in ABI (private). Prevents duplicate platform onboarding.
    mapping(address => address) private _attachedPaymaster;

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
        require(_tdocDeployer != address(0), "Zero address");
        require(_paymasterImplementation != address(0), "Zero address");
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

    /// @notice Owner-only onboarding. CREATE2 salt is unchanged so
    /// `computePaymasterAddress(bytes32)` stays ABI-compatible with `dev`.
    function deployPlatformPaymaster(
        address platformAddress,
        uint256 dailyLimit,
        bytes32 salt
    ) external onlyOwner returns (address paymaster) {
        require(platformAddress != address(0), "Zero address");
        require(
            _attachedPaymaster[platformAddress] == address(0),
            "Already onboarded"
        );

        paymaster = Clones.cloneDeterministic(paymasterImplementation, salt);
        PlatformPaymaster(payable(paymaster)).initialize(
            platformAddress,
            dailyLimit,
            tdocDeployer
        );
        _attachedPaymaster[platformAddress] = paymaster;
        emit PlatformOnboarded(platformAddress, paymaster);
    }

    // Address is determined solely by implementation + salt (not by constructor args).
    function computePaymasterAddress(
        bytes32 salt
    ) external view returns (address) {
        return
            Clones.predictDeterministicAddress(
                paymasterImplementation,
                salt,
                address(this)
            );
    }
}
