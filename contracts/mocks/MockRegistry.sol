// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// Deployed by MockTdocDeployer and used directly in mintDocument tests.
/// Implements the IAccessControl + ITradeTrustToken surfaces PlatformPaymaster calls.
contract MockTitleEscrow {}

contract MockRegistry {
    bytes32 public constant DEFAULT_ADMIN_ROLE = bytes32(0);
    mapping(bytes32 => mapping(address => bool)) private _roles;
    address public lastTitleEscrow;

    constructor(address initialAdmin) {
        _roles[DEFAULT_ADMIN_ROLE][initialAdmin] = true;
    }

    // IAccessControl
    function grantRole(bytes32 role, address account) external {
        _roles[role][account] = true;
    }

    function renounceRole(bytes32 role, address) external {
        _roles[role][msg.sender] = false;
    }

    function hasRole(bytes32 role, address account) external view returns (bool) {
        return _roles[role][account];
    }

    // ITradeTrustToken — deploys a fresh MockTitleEscrow each call
    function mint(
        address,
        address,
        uint256,
        bytes calldata
    ) external returns (address titleEscrow) {
        titleEscrow = address(new MockTitleEscrow());
        lastTitleEscrow = titleEscrow;
    }
}
