// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PlatformPaymaster} from "./PlatformPaymaster.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

contract PlatformAccountFactory is Ownable {
    address public tdocDeployer;
    address public paymasterImplementation;

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

    function deployPlatformPaymaster(
        address platformAddress,
        uint256 dailyLimit,
        bytes32 salt
    ) external returns (address paymaster) {
        // Bind the CREATE2 salt to the caller and platform so a third party who
        // only knows `salt` cannot deploy at the address this caller would get.
        paymaster = Clones.cloneDeterministic(
            paymasterImplementation,
            _paymasterSalt(msg.sender, platformAddress, salt)
        );
        PlatformPaymaster(payable(paymaster)).initialize(
            platformAddress,
            dailyLimit,
            tdocDeployer
        );
        emit PlatformOnboarded(platformAddress, paymaster);
    }

    // Predict the clone address for a specific deployer and platform.
    // `deployer` must be the account that will call deployPlatformPaymaster.
    function computePaymasterAddress(
        address deployer,
        address platformAddress,
        bytes32 salt
    ) external view returns (address) {
        return
            Clones.predictDeterministicAddress(
                paymasterImplementation,
                _paymasterSalt(deployer, platformAddress, salt),
                address(this)
            );
    }

    function _paymasterSalt(
        address deployer,
        address platformAddress,
        bytes32 salt
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(deployer, platformAddress, salt));
    }
}
