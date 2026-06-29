// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PlatformPaymaster} from "./PlatformPaymaster.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

contract PlatformAccountFactory is Ownable {
    address public tdocDeployer;
    address public paymasterImplementation;

    event PlatformOnboarded(address indexed platformAddress, address indexed paymaster);
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

    function deployPlatformPaymaster(
        address platformAddress,
        uint256 dailyLimit,
        bytes32 salt
    ) external returns (address paymaster) {
        paymaster = Clones.cloneDeterministic(paymasterImplementation, salt);
        PlatformPaymaster(payable(paymaster)).initialize(platformAddress, dailyLimit, tdocDeployer);
        emit PlatformOnboarded(platformAddress, paymaster);
    }

    // Address is determined solely by implementation + salt (not by constructor args).
    function computePaymasterAddress(bytes32 salt) external view returns (address) {
        return Clones.predictDeterministicAddress(paymasterImplementation, salt, address(this));
    }
}
