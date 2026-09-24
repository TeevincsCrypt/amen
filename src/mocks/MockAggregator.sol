// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Chainlink-style aggregator with full round history, for tests and local demos.
contract MockAggregator {
    struct Round {
        int256 answer;
        uint256 updatedAt;
    }

    uint8 public immutable decimals;
    string public description;
    uint80 public latestRound;
    bool public shouldRevert;
    mapping(uint80 => Round) internal _rounds;

    constructor(uint8 decimals_, string memory description_) {
        decimals = decimals_;
        description = description_;
    }

    /// @notice Push a new round published at `updatedAt`.
    function pushRound(int256 answer, uint256 updatedAt) public returns (uint80 roundId) {
        roundId = ++latestRound;
        _rounds[roundId] = Round(answer, updatedAt);
    }

    /// @notice Push a new round published now.
    function setAnswer(int256 answer) external returns (uint80) {
        return pushRound(answer, block.timestamp);
    }

    function setShouldRevert(bool r) external {
        shouldRevert = r;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        require(!shouldRevert, "MockAggregator: revert");
        Round memory r = _rounds[latestRound];
        return (latestRound, r.answer, r.updatedAt, r.updatedAt, latestRound);
    }

    function getRoundData(uint80 roundId) external view returns (uint80, int256, uint256, uint256, uint80) {
        require(!shouldRevert, "MockAggregator: revert");
        Round memory r = _rounds[roundId];
        require(r.updatedAt != 0, "No data present");
        return (roundId, r.answer, r.updatedAt, r.updatedAt, roundId);
    }
}
