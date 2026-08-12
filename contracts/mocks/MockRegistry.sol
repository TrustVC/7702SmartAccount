// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// Deployed by MockTdocDeployer and used directly in mintDocument tests.
/// Implements the IAccessControl + ITradeTrustToken surfaces PlatformPaymaster calls.
contract MockTitleEscrow {}

contract MockRegistry {
    bytes32 public constant DEFAULT_ADMIN_ROLE = bytes32(0);
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant RESTORER_ROLE = keccak256("RESTORER_ROLE");
    bytes32 public constant ACCEPTER_ROLE = keccak256("ACCEPTER_ROLE");

    mapping(bytes32 => mapping(address => bool)) private _roles;
    address public lastTitleEscrow;

    error AccessControlUnauthorizedAccount(address account, bytes32 role);
    error AccessControlBadConfirmation();

    // Mirrors RegistryAccess.__RegistryAccess_init: the real registry grants
    // all four roles to the single admin address passed at deploy time.
    constructor(address initialAdmin) {
        _roles[DEFAULT_ADMIN_ROLE][initialAdmin] = true;
        _roles[MINTER_ROLE][initialAdmin] = true;
        _roles[RESTORER_ROLE][initialAdmin] = true;
        _roles[ACCEPTER_ROLE][initialAdmin] = true;
    }

    // IAccessControl — mirrors OZ's default: granting any role requires
    // DEFAULT_ADMIN_ROLE, since the real registry never overrides role admins.
    function grantRole(bytes32 role, address account) external {
        if (!_roles[DEFAULT_ADMIN_ROLE][msg.sender]) {
            revert AccessControlUnauthorizedAccount(msg.sender, DEFAULT_ADMIN_ROLE);
        }
        _roles[role][account] = true;
    }

    function renounceRole(bytes32 role, address callerConfirmation) external {
        if (callerConfirmation != msg.sender) {
            revert AccessControlBadConfirmation();
        }
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
