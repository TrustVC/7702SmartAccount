// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Matches the existing deployed registry contract
interface IClientRegistry {
    function beneficiary() external view returns (address);
    function holder() external view returns (address);
}
