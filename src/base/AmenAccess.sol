// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Errors} from "../libraries/Errors.sol";

/// @title AmenAccess
/// @notice Ownable2Step owner plus a keeper set. Keepers run operational tasks (record closes,
///         create markets, move vault inventory) and can never set prices or move user funds out.
abstract contract AmenAccess is Ownable2Step {
    mapping(address => bool) public isKeeper;

    event KeeperSet(address indexed keeper, bool allowed);

    constructor(address owner_) Ownable(owner_) {}

    modifier onlyKeeperOrOwner() {
        if (!isKeeper[msg.sender] && msg.sender != owner()) revert Errors.NotKeeper(msg.sender);
        _;
    }

    /// @notice Grants or revokes keeper rights.
    /// @param keeper Address to update.
    /// @param allowed True to grant, false to revoke.
    function setKeeper(address keeper, bool allowed) external onlyOwner {
        if (keeper == address(0)) revert Errors.ZeroAddress();
        isKeeper[keeper] = allowed;
        emit KeeperSet(keeper, allowed);
    }
}
